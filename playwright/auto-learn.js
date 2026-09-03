#!/usr/bin/env node
/* ============================================================
 * 学习系统自动播放 —— 网址播放器（真实浏览器 + 真实视频播放）
 * ------------------------------------------------------------
 * 傻瓜式用法：
 *   双击同目录的 start.bat，输入学习平台网址，其余全自动：
 *   打开真实浏览器 → 等你手动登录 → 自动扫描建档（无需配置规则）
 *   → 自动进课 → 真实播放（防暂停 + 自动切下一集 + 关弹窗）
 *   → 课程播完自动返回 → 下一门 → 全部完成
 *
 * 命令行用法：
 *   node auto-learn.js --url <平台网址> [--rule <规则json>] [--limit 20] [--headless]
 *
 * 原理：真实 Chromium + 真实鼠标点击（isTrusted=true）+ 随机移动反检测，
 *       视频真实播放、进度真实上报，行为上与真人操作一致。
 * 首次运行弹出浏览器后请手动登录，登录态存 .auth/<域名>.json 下次复用。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 || i === process.argv.length - 1 ? def : process.argv[i + 1];
}
const hasArg = name => process.argv.includes('--' + name);

let pw;
try { pw = require('playwright'); } catch (e) {
  console.error('未安装 playwright，请先执行：\n  npm install playwright\n  npx playwright install chromium');
  process.exit(1);
}

/* ---------------- 内置规则（与油猴脚本共用格式，示例） ---------------- */
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
    courseListPage: null
  }
};

/* ---------------- 存储 ---------------- */
const AUTH_DIR = path.join(__dirname, '.auth');
const authFile = domain => path.join(AUTH_DIR, domain + '.json');
const doneFile = domain => path.join(AUTH_DIR, domain + '.done.json');
const draftFile = domain => path.join(AUTH_DIR, domain + '.draft.json');

function loadJSON(f, def) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return def; } }
function saveJSON(f, obj) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj, null, 2)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function promptUrl() {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('请输入学习平台网址（如 https://xxx.com）: ', ans => { rl.close(); resolve(ans.trim()); });
  });
}

/* ---------------- 页面操作（全部真实鼠标点击） ---------------- */
async function videoState(page, sel) {
  return page.evaluate(s => {
    const v = document.querySelector(s);
    if (!v) return null;
    const r = v.getBoundingClientRect();   // 忽略隐藏/不可见的视频元素
    if (r.width < 2 || r.height < 2) return null;
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
    const matches = [];
    for (const el of all) {
      const t = (el.innerText || el.textContent || '').trim();
      if (!t || t.length > 12) continue;
      if (txts.some(x => t.includes(x))) {
        const r = el.getBoundingClientRect();
        if (r.width >= 2 && r.height >= 2) matches.push(el);
      }
    }
    if (!matches.length) return null;
    // 优先真实按钮/链接（避免点中外层容器），否则用可见元素
    const clickables = matches.filter(el =>
      el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button'
    );
    const el = (clickables.length ? clickables : matches)[0];
    const r = el.getBoundingClientRect();
    el.scrollIntoView({ block: 'center' });
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
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
    const matches = [];
    for (const el of all) {
      const t = (el.innerText || el.textContent || '').trim();
      if (!t || t.length > 12) continue;
      if (texts.some(x => t.includes(x))) {
        const r = el.getBoundingClientRect();
        if (r.width >= 2 && r.height >= 2) matches.push(el);
      }
    }
    if (!matches.length) return null;
    const clickables = matches.filter(el =>
      el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button'
    );
    const el = (clickables.length ? clickables : matches)[0];
    const r = el.getBoundingClientRect();
    el.scrollIntoView({ block: 'center' });
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
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

/* 排空收尾弹窗：弹窗可能延迟出现，等待后多轮关闭直至点不到为止 */
async function dismissDialogs(page, vp) {
  if (!vp || !vp.dialogs || !vp.dialogs.length) return;
  await sleep(1200);   // 给弹窗时间出现
  for (let round = 0; round < 4; round++) {
    let closedAny = false;
    for (const d of vp.dialogs) {
      if (d.selector && await clickSelector(page, d.selector)) { closedAny = true; await sleep(300); }
      if (d.dismissTexts && d.dismissTexts.length && await clickText(page, d.dismissTexts)) { closedAny = true; await sleep(300); }
    }
    if (!closedAny) break;
  }
}

/* 验证"下一集"真的切换：新视频在播且时间戳与旧视频明显不同（最多 20 秒） */
async function waitSwitch(page, sel, prevTime) {
  for (let i = 0; i < 10; i++) {
    const st = await videoState(page, sel);
    if (st && !st.ended && st.time >= 0 && (prevTime < 0 || Math.abs(st.time - prevTime) > 1)) return true;
    await sleep(1500);
  }
  return false;
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

/* 页面是否有"内容信号"：视频 or 列表候选（用于登录判断） */
async function pageHasSignal(page) {
  return page.evaluate(() => {
    const vs = document.querySelectorAll('video');
    for (const v of vs) {
      const r = v.getBoundingClientRect();
      if (r.width >= 2 && r.height >= 2) return true;   // 只看可见视频
    }
    let found = false;
    document.querySelectorAll('div, ul, ol, section').forEach(p => {
      if (found || !p.children || p.children.length < 3 || p.children.length > 80) return;
      const sigs = {};
      for (const c of p.children) {
        if (c.tagName === 'VIDEO') continue;
        const cls = (typeof c.className === 'string' ? c.className : '').trim().split(/\s+/).filter(x => x && !/^(active|selected|current|hover|focus|open|show|hidden|is-|vjs-|el-)/.test(x)).slice(0, 2).join('.');
        if (!cls) continue;
        const sig = c.tagName.toLowerCase() + '.' + cls;
        sigs[sig] = (sigs[sig] || 0) + 1;
      }
      const top = Object.entries(sigs).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] >= 3) found = true;
    });
    return found;
  });
}

/* 自动扫描建档（与油猴脚本同启发式） */
async function draftRule(page) {
  const det = await page.evaluate(() => {
    const out = { chapter: null, course: null };
    const KEY_COURSE = /course|subject|class|homework|book/i;
    const KEY_CHAPTER = /chapter|lesson|item|wrapper|section|unit|video|module|info/i;
    const BAD = /menu|nav|crumb|pagi|tabs|swiper|crumbs|toolbar|topbar|header|footer/i;
    const STATE = /^(active|selected|current|hover|focus|open|show|hidden|is-|vjs-|el-)/;
    const qs = s => { try { return Array.from(document.querySelectorAll(s)); } catch (e) { return []; } };
    const detectActive = s => {
      const els = qs(s);
      if (els.length < 2) return null;
      const counts = {};
      for (const el of els) for (const c of el.classList) counts[c] = (counts[c] || 0) + 1;
      return Object.keys(counts).find(c => counts[c] === 1 && /active|current|playing|selected|chosen|on|focus/i.test(c)) || null;
    };
    const detectSkip = s => {
      const els = qs(s);
      const total = els.length;
      if (total < 3) return '';
      const counts = {};
      for (const el of els) for (const c of el.classList) counts[c] = (counts[c] || 0) + 1;
      return Object.keys(counts).find(c => counts[c] > 1 && counts[c] < total &&
        !/active|current|playing|selected|chosen|on|focus|hover|open|show|hidden/i.test(c) &&
        !/^vjs-/.test(c) && !/^el-/.test(c)) || '';
    };
    document.querySelectorAll('div, ul, ol, section').forEach(p => {
      if (!p.children || p.children.length < 3 || p.children.length > 80) return;
      const sigs = {};
      for (const c of p.children) {
        if (c.tagName === 'VIDEO') continue;
        const cls = (typeof c.className === 'string' ? c.className : '').trim().split(/\s+/)
          .filter(x => x && !STATE.test(x)).slice(0, 2).join('.');
        if (!cls) continue;
        const sig = c.tagName.toLowerCase() + '.' + cls;
        sigs[sig] = (sigs[sig] || 0) + 1;
      }
      let top = null;
      for (const k of Object.keys(sigs)) if (!top || sigs[k] > top[1]) top = [k, sigs[k]];
      if (!top || top[1] < 3 || BAD.test(top[0])) return;
      if (KEY_COURSE.test(top[0]) && !out.course) {
        out.course = { selector: top[0], activeClass: detectActive(top[0]) || 'active', skipClass: detectSkip(top[0]) };
      } else if (!KEY_COURSE.test(top[0]) && KEY_CHAPTER.test(top[0]) && !out.chapter) {
        out.chapter = { selector: top[0], activeClass: detectActive(top[0]) || 'active', skipClass: detectSkip(top[0]) };
      }
    });
    return out;
  });
  if (!det.chapter && !det.course) return null;
  const rule = {
    name: '自动建档',
    videoPage: {
      videoSelector: 'video',
      next: {
        strategy: 'button',
        listSelector: '',
        activeClass: 'active',
        skipClass: '',
        nameSelector: '',
        texts: ['下一课', '下节课', '下一节', '继续学习', '继续播放', '播放下一', '进入下一', '开始学习'],
        selector: ''
      },
      fallbackTexts: [],
      dialogs: [{ selector: '', dismissTexts: ['取消', '关闭'] }],
      completion: { stallSeconds: 24 }
    },
    courseListPage: null
  };
  if (det.chapter) {
    rule.videoPage.next = {
      strategy: 'chapter-list',
      listSelector: det.chapter.selector,
      activeClass: det.chapter.activeClass || 'active',
      skipClass: det.chapter.skipClass || '',
      nameSelector: '',
      texts: [],
      selector: ''
    };
  }
  if (det.course) {
    rule.courseListPage = {
      courseItemSelector: det.course.selector,
      nameSelector: '',
      enterTexts: [],
      doneSelector: '',
      doneTexts: ['已完成'],
      backSelector: '',
      backTexts: ['返回', '返回列表'],
      maxCoursesPerSession: 20
    };
  }
  return rule;
}

/* 等登录完成：页面出现视频或列表结构即认为已登录 */
async function waitLoggedIn(page) {
  for (let i = 0; i < 240; i++) {   // 最多 20 分钟
    if (await pageHasSignal(page)) return;
    await sleep(5000);
  }
  throw new Error('等待登录超时（20 分钟）');
}

/* ================= learnin.com.cn（网梯 Whaty）专项流程 =================
 * 课程总览页 → 扫描未完成小节（video-statistics 0/x）→ 点"开始学习"链接
 * → 新窗口学习页：等视频 → 真实播放到结束 → 关窗 → 回到列表下一节
 * 人脸认证弹窗出现时暂停并提示人工配合（摄像头必须是真人） */
async function faceDialogVisible(page) {
  try {
    return page.evaluate(() => {
      let vis = false;
      document.querySelectorAll('.el-dialog__wrapper').forEach(d => {
        if (d.style.display !== 'none' && (d.textContent || '').indexOf('人脸认证') !== -1) vis = true;
      });
      return vis;
    });
  } catch (e) { return false; }
}

async function playVideoInPage(page) {
  // 等视频出现（学习页可能先弹人脸认证）
  for (let i = 0; i < 20; i++) {
    if (page.isClosed()) return false;
    const st = await videoState(page, 'video');
    if (st) break;
    if (await faceDialogVisible(page)) {
      console.log('[learnin] ⚠ 检测到人脸认证，请看向摄像头并手动点确认（最多等 3 分钟…）');
      try {
        await page.waitForFunction(() => {
          let vis = false;
          document.querySelectorAll('.el-dialog__wrapper').forEach(d => {
            if (d.style.display !== 'none' && (d.textContent || '').indexOf('人脸认证') !== -1) vis = true;
          });
          return !vis;
        }, null, { timeout: 180000 });
        console.log('[learnin] ✅ 人脸认证已通过，继续…');
      } catch (e) { console.log('[learnin] 人脸认证超时，跳过该小节'); return false; }
    }
    await sleep(2000);
  }
  if (page.isClosed()) return false;
  await ensurePlaying(page, 'video');
  const why = await waitVideoEnd(page, 'video', 30);
  console.log('[learnin] 视频结束：' + why);
  return why === 'ended' || why === 'stalled';
}

async function runLearnin(context, page, limit) {
  let processed = 0;
  const skipped = new Set();
  while (processed < limit) {
    const sections = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('.outline-overview-section-item-container').forEach(sec => {
        const titleEl = sec.querySelector('.section-index-title');
        const link = sec.querySelector('a.router-link-button-new');
        const stats = sec.querySelector('.statistics-item.video-statistics');
        const txt = stats ? (stats.textContent || '').replace(/\s/g, '') : '';
        if (!link) return;
        out.push({
          title: titleEl ? titleEl.textContent.trim() : '（无标题）',
          href: link.getAttribute('href') || '',
          txt: txt,
          incomplete: txt.indexOf('0/') === 0
        });
      });
      return out;
    });
    const target = sections.find(s => s.incomplete && s.href && !skipped.has(s.href));
    if (!target) {
      console.log('[learnin] 没有可学习的未完成小节（可能还剩 PPT/教材/练习/作业，非视频课）🎉');
      break;
    }
    console.log('[learnin] 开始学习：「' + target.title + '」（' + target.txt + '）');
    let newPage = null;
    const popupP = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
    await page.evaluate(href => {
      const a = document.querySelector('a[href="' + href + '"]');
      if (a) a.click();
    }, target.href);
    newPage = await popupP;
    if (!newPage) {
      console.log('[learnin] 链接未打开新页面，跳过该小节');
      skipped.add(target.href);
      continue;
    }
    try { await newPage.waitForLoadState('domcontentloaded', { timeout: 30000 }); } catch (e) {}
    const ok = await playVideoInPage(newPage);
    if (ok) {
      console.log('[learnin] ✅ 完成：「' + target.title + '」');
      processed++;
      await sleep(3000);
    } else {
      console.log('[learnin] ⚠ 未完成：「' + target.title + '」，跳过重试');
      skipped.add(target.href);
    }
    try { await newPage.close(); } catch (e) {}
    await sleep(2000);
  }
  console.log('[learnin] 本轮完成 ' + processed + ' 个小节。');
}

/* ---------------- 主流程 ---------------- */
async function main() {
  const headless = hasArg('headless');
  const limit = parseInt(arg('limit', '20'), 10) || 20;
  let startUrl = arg('url', '');
  if (!startUrl) {
    const domain = arg('domain', '');
    startUrl = domain ? ('https://' + domain) : (await promptUrl());
  }
  if (!/^https?:\/\//.test(startUrl)) startUrl = 'https://' + startUrl;
  const host = startUrl.replace(/^https?:\/\//, '').split(/[/:]/)[0];

  /* 规则：--rule 文件 > 内置 > 历史自动建档 > 现场扫描建档 */
  let RULE = null;
  const ruleFile = arg('rule', '');
  if (ruleFile) {
    RULE = JSON.parse(fs.readFileSync(ruleFile, 'utf8'));
  } else if (BUILTIN[host]) {
    RULE = BUILTIN[host];
  } else {
    RULE = loadJSON(draftFile(host), null);
  }

  const browser = await pw.chromium.launch({
    headless,
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized']
  });
  const storageState = loadJSON(authFile(host), null);
  const context = await browser.newContext(storageState ? { storageState } : { viewport: null });
  const page = await context.newPage();
  const doneSet = new Set(loadJSON(doneFile(host), []));

  console.log('[auto-learn] 打开 ' + startUrl + ' …');
  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('[auto-learn] 请在浏览器里完成登录（首次运行需手动登录，登录完成会自动继续）…');
  await waitLoggedIn(page);
  await context.storageState({ path: authFile(host) });
  console.log('[auto-learn] 登录态已保存：' + authFile(host));

  /* 反空闲：随机移动鼠标 + 保持窗口前台 */
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
  let draftTry = 0;

  /* learnin.com.cn（网梯 Whaty）专项：课程总览自动播放（--url 给课程总览页） */
  if (host === 'www.learnin.com.cn' || host === 'learnin.com.cn') {
    console.log('[learnin] 检测到网梯学习平台：进入"课程总览自动播放"模式（人脸认证出现时会提示你配合）');
    await runLearnin(context, page, limit);
    stopAntiIdle = true;
    await browser.close();
    console.log('[auto-learn] 完成。');
    return;
  }

  while (entered < limit) {
    /* 没有规则 → 现场扫描建档（最多重试 12 次 = 60 秒） */
    if (!RULE) {
      draftTry++;
      RULE = await draftRule(page);
      if (RULE) {
        saveJSON(draftFile(host), RULE);
        console.log('[auto-learn] 已自动建档：' + JSON.stringify(RULE).slice(0, 200) + '…');
      } else if (draftTry >= 12) {
        console.log('[auto-learn] 扫描 60 秒仍未识别页面结构，请确认页面已加载完整，或改用 --rule 提供规则。');
        break;
      } else {
        await sleep(5000);
        continue;
      }
    }

    const vp = RULE.videoPage || { videoSelector: 'video' };
    const videoSel = vp.videoSelector || 'video';
    const st = await videoState(page, videoSel);

    if (!st) {
      /* 列表页 → 找下一门未完成课程 */
      const lp = RULE.courseListPage;
      if (!lp || !lp.courseItemSelector) {
        console.log('[auto-learn] 当前无视频且没有课程列表规则，结束。若这是课程列表页，请把页面结构发我。');
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
      }, { courseItemSelector: lp.courseItemSelector, doneSelector: lp.doneSelector || '', doneTexts: lp.doneTexts || [], nameSelector: lp.nameSelector || '', doneNames: Array.from(doneSet) });

      if (!course) {
        console.log('[auto-learn] 没有未完成的课程了 🎉');
        break;
      }
      const clickedEnter = await clickInside(page, lp.courseItemSelector, lp.enterTexts || []);
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

    // 排空收尾弹窗（弹窗延迟出现时多轮关闭，避免遮挡后续点击）
    await dismissDialogs(page, vp);

    // 点下一章：章节列表 → 文字按钮，然后验证是否真的切换
    const prevTime = st.time;
    const next = await nextChapterPoint(page, RULE);
    if (next) {
      await page.mouse.move(next.x, next.y, { steps: 6 });
      await page.mouse.click(next.x, next.y);
      console.log('[auto-learn] 已点击下一章：「' + next.text + '」');
    } else {
      const nextBtn = (RULE.videoPage.next && RULE.videoPage.next.texts) || [];
      if (await clickText(page, nextBtn)) {
        console.log('[auto-learn] 已点击"下一课"按钮');
      } else {
        console.log('[auto-learn] 没有可点的下一项…');
      }
    }
    const switched = await waitSwitch(page, videoSel, prevTime);
    if (switched) {
      console.log('[auto-learn] 已确认切换到新视频 ✓');
      await sleep(2000);
      continue;
    }
    console.log('[auto-learn] 未切换新视频（疑似本课程最后一集）');

    // 没有下一章 → 本课程播完 → 返回列表
    await dismissDialogs(page, vp);   // 返回前同样排干弹窗（可能又弹出）
    if (courseName) { doneSet.add(courseName); saveJSON(doneFile(host), Array.from(doneSet)); }
    console.log('[auto-learn] 课程「' + courseName + '」完成 ✅');
    courseName = null;
    const lp = RULE.courseListPage;
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
