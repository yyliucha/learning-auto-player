#!/usr/bin/env node
/* ============================================================
 * 学习系统自动播放 —— Playwright 兜底工具（Phase 4）
 * ------------------------------------------------------------
 * 用途：对付油猴脚本搞不定的平台（isTrusted 校验、后端心跳、复杂流程）。
 * 原理：真实 Chromium + 真实鼠标点击（isTrusted=true）+ 随机移动防检测，
 *       视频真实播放、进度真实上报，基本无法从行为上识别。
 *
 * 用法：
 *   node playwright/auto-learn.js --domain example.com [选项]
 * 选项：
 *   --url <起始页>     默认 https://<域名>
 *   --rule <规则json>  规则文件（与油猴脚本同一套格式）
 *   --limit <N>        本轮最多进出几门课，默认 20
 *   --headless         无头模式（调试用，正式跑建议默认有头）
 *
 * 首次运行：请在弹出的浏览器里手动登录，登录完成后脚本自动继续。
 * 登录态存 .auth/<域名>.json，下次免登录；完成记录存 .auth/<域名>.done.json。
 *
 * 安装：
 *   npm install playwright
 *   npx playwright install chromium
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 || i === process.argv.length - 1 ? def : process.argv[i + 1];
}
const hasArg = name => process.argv.includes('--' + name);

const domain = arg('domain', '');
if (!domain) {
  console.error('用法：node playwright/auto-learn.js --domain <域名> [--url <起始页>] [--rule <规则json>] [--limit 20]');
  process.exit(1);
}

let pw;
try { pw = require('playwright'); } catch (e) {
  console.error('未安装 playwright，先执行：\n  npm install playwright\n  npx playwright install chromium');
  process.exit(1);
}

/* ---------------- 内置规则（与油猴脚本共用格式） ---------------- */
/* 示例规则（example.com）仅供参考：改成你自己的域名，或用 --rule 传规则文件 */
const BUILTIN = {
  'example.com': {
    name: '示例学习平台',
    videoPage: {
      videoSelector: 'video',
      next: {
        strategy: 'chapter-list',
        listSelector: '.chapter-item .item-wrapper',
        activeClass: 'active',
        skipClass: 'no-video'
      },
      dialogs: [{ dismissTexts: ['取消', '关闭'] }],
      completion: { stallSeconds: 24 }
    },
    courseListPage: null   // 课程项选择器待配置（用 --rule 提供完整规则）
  }
};

function loadRule() {
  const file = arg('rule', '');
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  return BUILTIN[domain] || null;
}
const RULE = loadRule();
if (!RULE) {
  console.error('没有 ' + domain + ' 的规则：请用 --rule <规则json> 提供（格式同油猴脚本规则）');
  process.exit(1);
}

/* ---------------- 存储 ---------------- */
const AUTH_DIR = path.join(__dirname, '.auth');
const authFile = path.join(AUTH_DIR, domain + '.json');
const doneFile = path.join(AUTH_DIR, domain + '.done.json');
function loadJSON(f, def) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return def; } }
function saveJSON(f, obj) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj, null, 2)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ---------------- 页面操作（全部真实鼠标点击） ---------------- */
async function videoState(page, sel) {
  return page.evaluate(s => {
    const v = document.querySelector(s);
    if (!v) return null;
    return { ended: v.ended, paused: v.paused, time: isFinite(v.currentTime) ? v.currentTime : -1 };
  }, sel);
}

async function ensurePlaying(page, sel) {
  await page.evaluate(s => {
    const v = document.querySelector(s);
    if (v) {
      v.muted = true;
      try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    }
  }, sel);
}

async function pointOf(page, selector) {
  const ok = await page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    return true;
  }, selector);
  if (!ok) return null;
  await sleep(150);
  return page.evaluate(sel => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
}

async function clickSelector(page, selector) {
  const pt = await pointOf(page, selector);
  if (!pt) return false;
  await page.mouse.move(pt.x, pt.y, { steps: 6 });
  await page.mouse.click(pt.x, pt.y);
  return true;
}

async function clickText(page, texts) {
  if (!texts || !texts.length) return false;
  const pt = await page.evaluate(txts => {
    const all = document.querySelectorAll('button, a, [role="button"], div, span, li');
    for (const el of all) {
      const t = (el.innerText || el.textContent || '').trim();
      if (!t || t.length > 12) continue;
      if (txts.some(x => t.includes(x))) {
        const r = el.getBoundingClientRect();
        if (r.width >= 2 && r.height >= 2) {
          el.scrollIntoView({ block: 'center' });
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
      }
    }
    return null;
  }, texts);
  if (!pt) return false;
  await sleep(150);
  await page.mouse.click(pt.x, pt.y);
  return true;
}

async function clickInside(page, parentSel, texts) {
  if (!texts || !texts.length) return false;
  const pt = await page.evaluate(({ parentSel, texts }) => {
    const parent = document.querySelector(parentSel);
    if (!parent) return null;
    const all = parent.querySelectorAll('button, a, [role="button"], span, div');
    for (const el of all) {
      const t = (el.innerText || el.textContent || '').trim();
      if (!t || t.length > 12) continue;
      if (texts.some(x => t.includes(x))) {
        const r = el.getBoundingClientRect();
        if (r.width >= 2 && r.height >= 2) {
          el.scrollIntoView({ block: 'center' });
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
      }
    }
    return null;
  }, { parentSel, texts });
  if (!pt) return false;
  await sleep(150);
  await page.mouse.click(pt.x, pt.y);
  return true;
}

/* 下一章节（与油猴脚本同逻辑，返回中心点） */
async function nextChapterPoint(page, rule) {
  const n = rule.videoPage && rule.videoPage.next;
  if (!n || n.strategy !== 'chapter-list' || !n.listSelector) return null;
  return page.evaluate(cfg => {
    const items = Array.from(document.querySelectorAll(cfg.listSelector));
    const idx = items.findIndex(el => el.classList.contains(cfg.activeClass || 'active'));
    if (idx === -1) return null;
    for (let i = idx + 1; i < items.length; i++) {
      if (cfg.skipClass && items[i].classList.contains(cfg.skipClass)) continue;
      const r = items[i].getBoundingClientRect();
      items[i].scrollIntoView({ block: 'center' });
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: (items[i].innerText || '').slice(0, 20) };
    }
    return null;
  }, n);
}

/* 等视频播完：ended 事件，或时间戳连续 stall 秒不动 */
async function waitVideoEnd(page, sel, stallSeconds) {
  let lastTime = -1, stall = 0;
  const stallTicks = Math.max(3, Math.ceil(stallSeconds / 3));
  for (;;) {
    const st = await videoState(page, sel);
    if (!st) return 'no-video';
    if (st.ended) return 'ended';
    if (st.paused) {
      await ensurePlaying(page, sel);
      stall++;
    } else if (st.time > 0 && Math.abs(st.time - lastTime) < 0.5) {
      stall++;
    } else {
      stall = 0;
      lastTime = st.time;
    }
    if (stall >= stallTicks) return 'stalled';
    await sleep(3000);
  }
}

/* 等登录完成：页面出现视频或课程列表即算 */
async function waitLoggedIn(page, videoSel, courseSel) {
  for (let i = 0; i < 240; i++) {   // 最多 20 分钟
    const ok = await page.evaluate(({ videoSel, courseSel }) =>
      !!document.querySelector(videoSel) || (courseSel && !!document.querySelector(courseSel)),
      { videoSel, courseSel });
    if (ok) return;
    await sleep(5000);
  }
  throw new Error('等待登录超时（20 分钟）');
}

/* ---------------- 主流程 ---------------- */
async function main() {
  const headless = hasArg('headless');
  const limit = parseInt(arg('limit', '20'), 10) || 20;
  const startUrl = arg('url', 'https://' + domain);
  const vp = RULE.videoPage || {};
  const videoSel = vp.videoSelector || 'video';
  const lp = RULE.courseListPage || null;
  const courseSel = lp && lp.courseItemSelector ? lp.courseItemSelector : '';

  const browser = await pw.chromium.launch({
    headless,
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized']
  });
  const storageState = loadJSON(authFile, null);
  const context = await browser.newContext(storageState ? { storageState } : { viewport: null });
  const page = await context.newPage();
  const doneSet = new Set(loadJSON(doneFile, []));

  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('[auto-learn] 请确认浏览器里已登录（首次运行请手动登录，完成后自动继续）…');
  await waitLoggedIn(page, videoSel, courseSel);
  await context.storageState({ path: authFile });
  console.log('[auto-learn] 登录态已保存：' + authFile);

  // 反空闲：随机移动鼠标 + 保持窗口前台
  let stopAntiIdle = false;
  const antiIdle = (async () => {
    while (!stopAntiIdle) {
      await sleep(15000 + Math.random() * 15000);
      try {
        const vpz = page.viewportSize() || { width: 1280, height: 800 };
        await page.bringToFront();
        await page.mouse.move(100 + Math.random() * (vpz.width - 200), 100 + Math.random() * (vpz.height - 200), { steps: 10 });
      } catch (e) {}
    }
  })();

  let entered = 0;
  let courseName = null;

  while (entered < limit) {
    const st = await videoState(page, videoSel);

    if (!st) {
      /* 列表页 → 找下一门未完成课程 */
      if (!lp || !courseSel) {
        console.log('[auto-learn] 当前无视频且没有课程列表规则，结束。');
        break;
      }
      const course = await page.evaluate(cfg => {
        const items = Array.from(document.querySelectorAll(cfg.courseItemSelector));
        for (const it of items) {
          if (cfg.doneSelector && it.querySelector(cfg.doneSelector)) continue;
          const t = (it.innerText || '').trim();
          if (cfg.doneTexts && cfg.doneTexts.some(x => t.includes(x))) continue;
          const nameEl = cfg.nameSelector ? it.querySelector(cfg.nameSelector) : null;
          const name = (nameEl ? nameEl.textContent : t).trim().slice(0, 40);
          if (cfg.doneNames.includes(name)) continue;
          const r = it.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          it.scrollIntoView({ block: 'center' });
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, name };
        }
        return null;
      }, { courseItemSelector: courseSel, doneSelector: lp.doneSelector || '', doneTexts: lp.doneTexts || [], nameSelector: lp.nameSelector || '', doneNames: Array.from(doneSet) });

      if (!course) {
        console.log('[auto-learn] 没有未完成的课程了 🎉');
        break;
      }
      // 优先点课程项上的入口按钮（如"开始学习"），否则点课程项本身
      const clickedEnter = await clickInside(page, courseSel, lp.enterTexts || []);
      if (!clickedEnter) {
        await page.mouse.move(course.x, course.y, { steps: 6 });
        await page.mouse.click(course.x, course.y);
      }
      courseName = course.name;
      entered++;
      console.log('[auto-learn] 进入课程「' + courseName + '」（第 ' + entered + ' 门）');
      await sleep(5000);
      continue;
    }

    /* 视频页 → 确保在播，等播完 */
    await ensurePlaying(page, videoSel);
    console.log('[auto-learn] 播放中…（' + (courseName || '?') + '）');
    const why = await waitVideoEnd(page, videoSel, (vp.completion && vp.completion.stallSeconds) || 24);
    console.log('[auto-learn] 本集结束：' + why);

    // 关收尾弹窗
    for (const d of (vp.dialogs || [])) {
      if (d.selector) await clickSelector(page, d.selector);
      if (d.dismissTexts && d.dismissTexts.length) await clickText(page, d.dismissTexts);
      await sleep(500);
    }

    // 点下一章
    const next = await nextChapterPoint(page, RULE);
    if (next) {
      await page.mouse.move(next.x, next.y, { steps: 6 });
      await page.mouse.click(next.x, next.y);
      console.log('[auto-learn] 已点击下一章：「' + next.text + '」');
      await sleep(5000);
      continue;
    }

    // 没有下一章 → 本课程播完 → 返回列表
    if (courseName) { doneSet.add(courseName); saveJSON(doneFile, Array.from(doneSet)); }
    console.log('[auto-learn] 课程「' + courseName + '」完成 ✅');
    courseName = null;
    if (!lp) { console.log('[auto-learn] 没有课程列表规则，到此为止。'); break; }
    let back = lp.backSelector ? await clickSelector(page, lp.backSelector) : false;
    if (!back) back = await clickText(page, lp.backTexts || ['返回']);
    console.log('[auto-learn] 返回列表：' + (back ? '成功' : '失败，请检查 backSelector/backTexts'));
    await sleep(5000);
  }

  stopAntiIdle = true;
  await browser.close();
  console.log('[auto-learn] 完成。本轮进出课程 ' + entered + ' 门。');
}

main().catch(e => {
  console.error('[auto-learn] 出错：' + (e && e.message));
  process.exit(1);
});
