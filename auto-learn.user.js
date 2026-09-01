// ==UserScript==
// @name         学习系统自动播放（规则驱动版）
// @namespace    local.auto-learn
// @version      1.6.1
// @description  防暂停 + 自动续播 + 自动切下一集 + 多门课遍历 + 录制向导 + 全自动建档 + 学习记录
// @author       you
// @match        *://*/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

/* ============================================================
 * 学习系统自动播放 v1.6 —— 全自动建档 + 学习记录
 * ------------------------------------------------------------
 * 安装：
 *   方式 A（推荐）：Tampermonkey 新建脚本，粘贴本文件内容保存。
 *   方式 B（临时）：F12 → Console → 粘贴全部内容 → 回车。
 *   两种方式行为一致，规则/模式/学习记录都存 localStorage。
 *
 * 三种模式（点击右下角徽标循环切换）：
 *   ▶ 单课连播（默认）：一门课内自动切下一集
 *   🚀 自动遍历：一门课播完 → 返回列表 → 自动进下一门课
 *   ⏸ 关闭：完全停手
 *
 * v1.6 新功能：
 *   - 全自动建档：陌生平台首次访问自动扫描并生成"草稿规则"，运行成功自动转正，
 *     失败自动回退通用模式并记录诊断（无需手动配置，点开页面即用）
 *   - 学习记录：自动统计完成视频数 / 观看时长 / 完成课程数 / 今日进度（本地存储），
 *     徽标显示今日进度，__autoLearn.report() 出日报/周报
 *   - 诊断导出：__autoLearn.diagnose() 输出完整诊断报告（规则、失败记录、页面扫描、
 *     视频状态），供排查，无需手动翻 F12
 *
 * 录制向导（手动配置时使用）：
 *   控制台输入 __autoLearn.wizard() 打开面板，然后：
 *   ① 点一个"角色"按钮（如"② 章节项"）
 *   ② 去页面上点对应的元素（鼠标悬停有黄色高亮框）
 *   ③ 全部点完 → 点"生成规则并试运行" → 规则保存并立即生效
 *   提示：点"章节项/课程项"时点行内任意位置都行（自动定位到行容器）；
 *         点按钮类角色时点图标/文字都行（自动定位到按钮元素）。
 *
 * 控制台命令（F12 → Console）：
 *   __autoLearn.help()          命令列表
 *   __autoLearn.getRule()       查看当前域名规则
 *   __autoLearn.saveRule({...}) 保存自定义规则（立即生效）
 *   __autoLearn.clearRule()     删除自定义规则（回退内置/通用）
 *   __autoLearn.exportRules()   导出本域名规则（JSON 文本）
 *   __autoLearn.importRules('{...}') 导入规则
 *   __autoLearn.setMode('traverse')  切换模式：single|traverse|off
 *   __autoLearn.scan()          扫描页面结构（辅助写规则）
 *   __autoLearn.wizard()        打开/关闭录制向导
 *   __autoLearn.clearDone()     清空"已完成课程"记录
 *   __autoLearn.report()        学习记录日报/周报
 *   __autoLearn.diagnose()      生成诊断报告（排查用）
 *   __autoLearn.clearStats()    清空学习记录
 *
 * 跑之前：Windows 别休眠（powercfg /change standby-timeout-ac 0），别锁屏。
 * ============================================================ */

(function () {
  'use strict';

  if (window.__AUTO_LEARN__) return;
  window.__AUTO_LEARN__ = true;

  /* ---------------- 内置规则库 ---------------- */
  /* 示例规则（example.com）仅供参考：改成你自己的域名，或直接用录制向导 /
     __autoLearn.saveRule 配置（规则存 localStorage，不进代码） */
  const BUILTIN_RULES = {
    'example.com': {
      name: '示例学习平台',
      videoPage: {
        videoSelector: 'video',
        next: {
          strategy: 'chapter-list',
          listSelector: '.chapter-item .item-wrapper',
          activeClass: 'active',
          skipClass: 'no-video',
          nameSelector: '.chapter-name',
          texts: [],
          selector: ''
        },
        fallbackTexts: ['继续学习', '继续播放', '下一课', '下节课', '下一节', '下一个', '播放下一', '进入下一', '开始学习', '开始播放'],
        dialogs: [{ selector: '', dismissTexts: ['取消', '关闭'] }],
        completion: { stallSeconds: 24 }
      },
      courseListPage: {
        courseItemSelector: '',          // 待配置：课程列表页的课程项（可用录制向导自动生成）
        nameSelector: '',
        enterTexts: [],
        doneSelector: '',
        doneTexts: ['已完成'],
        backSelector: '.back-btn',       // 视频页左上角返回按钮（图标按钮，无文字）
        backTexts: ['返回', '返回列表'],
        maxCoursesPerSession: 20
      }
    }
  };

  /* 通用兜底规则（没有配置的域名） */
  const GENERIC_RULE = {
    name: '通用模式',
    videoPage: {
      videoSelector: 'video',
      next: {
        strategy: 'button',
        listSelector: '',
        activeClass: 'active',
        skipClass: '',
        nameSelector: '',
        texts: ['继续观看', '继续学习', '继续播放', '下一课', '下节课', '下一节', '下一个', '播放下一', '进入下一', '开始学习', '开始播放'],
        selector: ''
      },
      fallbackTexts: [],
      dialogs: [{ selector: '', dismissTexts: ['取消', '关闭'] }],
      completion: { stallSeconds: 24 }
    },
    courseListPage: null
  };

  /* ---------------- 规则存取（localStorage） ---------------- */
  const PREFIX = 'autoLearn.rule.';

  function normalizeListPage(lp) {
    if (!lp || typeof lp !== 'object') return null;
    return {
      courseItemSelector: lp.courseItemSelector || '',
      nameSelector: lp.nameSelector || '',
      enterTexts: Array.isArray(lp.enterTexts) ? lp.enterTexts : [],
      doneSelector: lp.doneSelector || '',
      doneTexts: Array.isArray(lp.doneTexts) ? lp.doneTexts : [],
      backSelector: lp.backSelector || '',
      backTexts: Array.isArray(lp.backTexts) ? lp.backTexts : [],
      maxCoursesPerSession: lp.maxCoursesPerSession || 20
    };
  }

  function normalizeRule(rule) {
    const vp = (rule && rule.videoPage) || {};
    const next = vp.next || {};
    const completion = vp.completion || {};
    return {
      name: (rule && rule.name) || '未命名规则',
      draft: !!(rule && rule.draft),
      videoPage: {
        videoSelector: vp.videoSelector || 'video',
        next: {
          strategy: next.strategy || 'button',
          listSelector: next.listSelector || '',
          activeClass: next.activeClass || 'active',
          skipClass: next.skipClass || '',
          nameSelector: next.nameSelector || '',
          texts: Array.isArray(next.texts) ? next.texts : [],
          selector: next.selector || ''
        },
        fallbackTexts: Array.isArray(vp.fallbackTexts) ? vp.fallbackTexts : [],
        dialogs: Array.isArray(vp.dialogs)
          ? vp.dialogs.map(d => ({
              selector: (d && d.selector) || '',
              dismissTexts: Array.isArray(d && d.dismissTexts) ? d.dismissTexts : []
            }))
          : [],
        completion: { stallSeconds: completion.stallSeconds || 24 }
      },
      courseListPage: normalizeListPage((rule && rule.courseListPage) || null)
    };
  }

  function getRule() {
    let stored = null;
    try {
      const raw = localStorage.getItem(PREFIX + location.hostname);
      if (raw) stored = JSON.parse(raw);
    } catch (e) {}
    return normalizeRule(stored || BUILTIN_RULES[location.hostname] || GENERIC_RULE);
  }

  let RULE = getRule();

  /* ---------------- 学习记录（本地统计，不上传） ---------------- */
  const STATS_KEY = 'autoLearn.stats.' + location.hostname;

  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function loadStats() {
    try {
      const s = JSON.parse(localStorage.getItem(STATS_KEY) || 'null');
      if (s && typeof s === 'object' && s.log) return s;
    } catch (e) {}
    return { videos: 0, courses: 0, seconds: 0, days: {}, log: [] };
  }

  function saveStats(s) {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch (e) {}
  }

  function recordStat(type, detail, seconds) {
    const s = loadStats();
    const day = todayKey();
    const d = s.days[day] || { videos: 0, seconds: 0 };
    if (type === 'video') {
      s.videos++;
      d.videos++;
      const sec = Math.round(seconds || 0);
      if (sec > 0 && sec < 14400) { s.seconds += sec; d.seconds += sec; }
    } else if (type === 'course') {
      s.courses++;
    }
    s.days[day] = d;
    s.log.push({ t: Date.now(), type: type, detail: String(detail || '').slice(0, 120) });
    if (s.log.length > 500) s.log = s.log.slice(-500);
    saveStats(s);
  }

  function getTodayStats() {
    const s = loadStats();
    const d = s.days[todayKey()] || { videos: 0, seconds: 0 };
    return { videos: s.videos, courses: s.courses, seconds: s.seconds, today: d };
  }

  /* ---------------- 全自动建档（扫描 → 草稿规则 → 运行验证转正） ---------------- */
  let draftAttempted = false, draftTries = 0;

  /* 在页面里找"重复结构"候选（≥3 个同结构子元素的容器），并区分课程/章节 */
  function detectListCandidates() {
    const out = { chapter: null, course: null };
    const KEY_COURSE = /course|subject|class|homework|book/i;
    const KEY_CHAPTER = /chapter|lesson|item|wrapper|section|unit|video|module|info/i;
    const BAD = /menu|nav|crumb|pagi|tabs|swiper|crumbs|toolbar|topbar|header|footer/i;
    const STATE = /^(active|selected|current|hover|focus|open|show|hidden|is-|vjs-|el-)/;
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
      const sel = top[0];
      if (KEY_COURSE.test(sel) && !out.course) {
        out.course = { selector: sel, activeClass: detectActiveClass(sel) || 'active', skipClass: detectSkipClass(sel) };
      } else if (!KEY_COURSE.test(sel) && KEY_CHAPTER.test(sel) && !out.chapter) {
        out.chapter = { selector: sel, activeClass: detectActiveClass(sel) || 'active', skipClass: detectSkipClass(sel) };
      }
    });
    return out;
  }

  /* 自动建档：无规则/无内置的域名，扫描页面生成草稿规则（可多次合并） */
  function maybeAutoDraft() {
    if (!document.body) return false;
    const host = location.hostname;
    let stored = null;
    try {
      const raw = localStorage.getItem(PREFIX + host);
      if (raw) stored = JSON.parse(raw);
    } catch (e) {}
    if (stored && !stored.draft) return true;      // 已有稳定规则
    if (!stored && BUILTIN_RULES[host]) return true;  // 已有内置规则

    const found = detectListCandidates();
    if (!found.chapter && !found.course) return false;   // 本页无候选，等下一轮

    const rule = (stored && stored.draft) ? normalizeRule(stored) : {
      name: '自动建档',
      draft: true,
      videoPage: {
        videoSelector: 'video',
        next: {
          strategy: 'button',
          listSelector: '',
          activeClass: 'active',
          skipClass: '',
          nameSelector: '',
          texts: GENERIC_RULE.videoPage.next.texts,
          selector: ''
        },
        fallbackTexts: [],
        dialogs: [{ selector: '', dismissTexts: ['取消', '关闭'] }],
        completion: { stallSeconds: 24 }
      },
      courseListPage: null
    };
    if (found.chapter) {
      rule.videoPage.next = {
        strategy: 'chapter-list',
        listSelector: found.chapter.selector,
        activeClass: found.chapter.activeClass || 'active',
        skipClass: found.chapter.skipClass || '',
        nameSelector: '',
        texts: [],
        selector: ''
      };
    }
    if (found.course) {
      rule.courseListPage = {
        courseItemSelector: found.course.selector,
        nameSelector: '',
        enterTexts: [],
        doneSelector: '',
        doneTexts: ['已完成'],
        backSelector: '',
        backTexts: ['返回'],
        maxCoursesPerSession: 20
      };
    }
    rule.draft = true;
    try { localStorage.setItem(PREFIX + host, JSON.stringify(rule)); } catch (e) { return false; }
    RULE = getRule();
    lastAction = '已自动建档草稿规则（运行成功将自动转正）';
    updateBadge();
    return true;
  }

  /* 草稿转正：运行验证通过后去掉草稿标记 */
  function promoteDraft() {
    if (!RULE.draft) return;
    const clean = JSON.parse(JSON.stringify(RULE));
    delete clean.draft;
    try { localStorage.setItem(PREFIX + location.hostname, JSON.stringify(clean)); } catch (e) {}
    RULE = getRule();
    updateBadge();
  }

  /* 失败处理：记录诊断；草稿规则失败时回退通用模式 */
  function fallbackToGeneric(reason) {
    recordStat('fail', reason, 0);
    if (!RULE.draft) return false;
    RULE = normalizeRule(GENERIC_RULE);
    recordStat('fail', '草稿规则已回退通用模式', 0);
    return true;
  }

  /* ---------------- 模式系统（单课连播 / 自动遍历 / 关闭） ---------------- */
  const MODE_KEY = 'autoLearn.mode';
  const MODES = ['single', 'traverse', 'off'];
  let mode = 'single';
  try {
    const m = localStorage.getItem(MODE_KEY);
    if (MODES.indexOf(m) !== -1) mode = m;
  } catch (e) {}

  function setMode(m) {
    if (MODES.indexOf(m) === -1) return '模式无效：single | traverse | off';
    mode = m;
    try { localStorage.setItem(MODE_KEY, m); } catch (e) {}
    updateBadge();
    return '模式已切换：' + m;
  }

  function modePrefix() {
    return mode === 'off' ? '⏸ ' : mode === 'traverse' ? '🚀 ' : '▶ ';
  }

  /* ---------------- 全局配置 ---------------- */
  const CFG = {
    resumeMs: 8000,          // 每隔多久强制检查一次播放状态
    fakeActivityMs: 25000,   // 每隔多久伪造一次鼠标/键盘活动
    resumeTexts: ['继续播放', '点击继续', '恢复播放', '继续学习']  // "已暂停"遮罩
  };

  let sawVideo = false;
  let lastAction = '启动';
  let badge = null;
  let flowRunning = false;
  let lastTime = -1, stallCount = 0, resumeFails = 0;

  /* ---------------- 课程遍历状态 ---------------- */
  let currentCourseKey = null;   // 当前正在播的课程标识（课程名或序号）
  let enteredAt = 0;             // 进入课程的时间戳（超时重试用）
  let traverseAttempts = 0;      // 本轮进出课程次数（防死循环）
  const DONE_KEY = 'autoLearn.done.' + location.hostname;
  const SESSION_KEY = 'autoLearn.current.' + location.hostname;

  function getDoneSet() {
    try { return JSON.parse(sessionStorage.getItem(DONE_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function addDone(key) {
    if (!key) return;
    const set = getDoneSet();
    if (set.indexOf(key) === -1) {
      set.push(key);
      try { sessionStorage.setItem(DONE_KEY, JSON.stringify(set)); } catch (e) {}
    }
  }
  function loadSession() {
    try { currentCourseKey = sessionStorage.getItem(SESSION_KEY) || null; } catch (e) {}
  }
  function saveSession() {
    try {
      if (currentCourseKey) sessionStorage.setItem(SESSION_KEY, currentCourseKey);
      else sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }
  loadSession();

  /* 1. 让页面永远以为"标签页可见" */
  try { Object.defineProperty(document, 'hidden', { get: () => false, configurable: true }); } catch (e) {}
  try { Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true }); } catch (e) {}
  try { document.hasFocus = () => true; } catch (e) {}
  document.onvisibilitychange = null;
  document.onblur = null;
  window.onblur = null;

  /* 2. 吞掉"切标签页/失焦/页面隐藏"事件，让站点收不到暂停信号
        （只在 document-start 阶段生效，所以推荐方式 A） */
  const _ael = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (type === 'visibilitychange' || type === 'pagehide') return;
    if (type === 'blur' && (this === window || this === document)) return;
    return _ael.call(this, type, fn, opts);
  };

  /* 3. 小工具（全部由规则驱动） */
  function findVideo() {
    let all = [];
    try {
      all = Array.from(document.querySelectorAll(RULE.videoPage.videoSelector))
        .filter(el => el.tagName === 'VIDEO');
    } catch (e) {
      all = Array.from(document.querySelectorAll('video'));
    }
    if (!all.length) return null;
    // 页面可能残留多个 <video>，优先返回"正在播/没播完"的那个
    for (const v of all) if (!v.ended && !v.paused && v.currentTime > 0) return v;
    for (const v of all) if (!v.ended && v.currentTime > 0) return v;
    for (const v of all) if (!v.ended) return v;
    return all[all.length - 1];
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.offsetParent !== null) return true;
    return el.getClientRects().length > 0;
  }

  function clickEl(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      try { el.dispatchEvent(new MouseEvent(type, opts)); } catch (e) {}
    }
  }

  function findByTexts(texts) {
    if (!texts || !texts.length) return null;
    const all = document.querySelectorAll('button, a, [role="button"], div, span, li');
    const matches = [];
    for (const el of all) {
      if (badge && badge.contains(el)) continue;
      if (wizardPanel && wizardPanel.contains(el)) continue;
      const t = (el.innerText || el.textContent || '').trim();
      if (!t || t.length > 12) continue;
      if (texts.some(x => t.includes(x))) matches.push(el);
    }
    if (!matches.length) return null;
    const clickable = matches.filter(el =>
      (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') && isVisible(el)
    );
    const visible = matches.filter(isVisible);
    const pool = clickable.length ? clickable : visible;
    if (!pool.length) return null;      // 只点可见的，避免误点隐藏元素
    const list = pool.slice();
    list.sort((a, b) => b.getClientRects().length - a.getClientRects().length);
    return list[0] || null;
  }

  /* 章节列表策略：找"当前章节"的下一个 */
  function findNextChapter() {
    const n = RULE.videoPage.next;
    if (n.strategy !== 'chapter-list' || !n.listSelector) return null;
    let items = [];
    try { items = Array.from(document.querySelectorAll(n.listSelector)); } catch (e) { return null; }
    if (!items.length) return null;
    const idx = items.findIndex(el => el.classList.contains(n.activeClass));
    if (idx === -1) return null;
    for (let i = idx + 1; i < items.length; i++) {
      if (n.skipClass && items[i].classList.contains(n.skipClass)) continue;
      return items[i];
    }
    return null;   // 没有下一个了（可能已全部播完）
  }

  function nextBySelector() {
    const n = RULE.videoPage.next;
    if (!n.selector) return null;
    try {
      const el = document.querySelector(n.selector);
      return (el && isVisible(el)) ? el : null;
    } catch (e) { return null; }
  }

  function findDialogDismiss() {
    for (const d of RULE.videoPage.dialogs) {
      if (d.selector) {
        try {
          const el = document.querySelector(d.selector);
          if (el && isVisible(el)) return el;
        } catch (e) {}
      }
      const btn = findByTexts(d.dismissTexts);
      if (btn) return btn;
    }
    return null;
  }

  function fmt(s) {
    if (!isFinite(s) || s < 0) return '--:--';
    s = Math.floor(s);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  /* 4. 注入提示条（书签/控制台使用时第一时间给反馈，任何页面都可见） */
  function showToast(msg) {
    try {
      let t = document.getElementById('auto-learn-toast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'auto-learn-toast';
        t.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147483647;' +
          'background:rgba(15,25,45,.94);color:#8fe3a8;font:13px/1.6 "Microsoft YaHei",sans-serif;' +
          'padding:8px 16px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.5);max-width:80vw;text-align:center;';
        (document.body || document.documentElement).appendChild(t);
      }
      t.textContent = msg;
      clearTimeout(window.__toastTimer);
      window.__toastTimer = setTimeout(function () { try { t.remove(); } catch (e) {} }, 8000);
    } catch (e) {}
  }

  /* 5. 状态徽标（右下角，点击循环切换模式） */
  function makeBadge() {
    if (!document.body) return;
    badge = document.createElement('div');
    badge.id = 'auto-learn-badge';
    badge.style.cssText =
      'position:fixed;right:10px;bottom:10px;z-index:2147483647;' +
      'font:12px/1.7 "Microsoft YaHei",sans-serif;color:#7CFC98;' +
      'background:rgba(15,25,45,.88);padding:3px 10px;border-radius:6px;' +
      'cursor:pointer;max-width:420px;overflow:hidden;' +
      'text-overflow:ellipsis;white-space:nowrap;box-shadow:0 1px 6px rgba(0,0,0,.3);';
    badge.title = '点击切换模式：单课连播 → 自动遍历 → 关闭';
    badge.addEventListener('click', () => {
      setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
    });
    document.body.appendChild(badge);
  }

  function updateBadge() {
    if (!badge) return;
    const color = mode === 'off' ? '#FF8A8A' : mode === 'traverse' ? '#7FD4FF' : '#7CFC98';
    badge.style.color = color;
    const name = RULE.name + (RULE.draft ? '·草稿' : '');
    const today = getTodayStats().today;
    const extra = sawVideo
      ? (' ｜ 今日 ' + today.videos + '集·' + Math.round(today.seconds / 60) + '分')
      : '';
    badge.textContent = modePrefix() + '[' + name + '] ' + lastAction + extra;
  }

  /* 5. 伪造"人还在"的活动信号 */
  function fakeActivity() {
    const x = 50 + Math.random() * (window.innerWidth - 100);
    const y = 50 + Math.random() * (window.innerHeight - 100);
    const evt = new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y, view: window });
    document.dispatchEvent(evt);
    window.dispatchEvent(evt);
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Shift' }));
  }

  /* 6. 一集结束 → 关弹窗 + 点"下一项"（核心流程，规则驱动） */
  function startNextFlow() {
    if (flowRunning || mode === 'off' || wizardOpen) return;
    flowRunning = true;

    const startV = findVideo();
    const startT = (startV && isFinite(startV.currentTime) && startV.currentTime > 0)
      ? startV.currentTime : -1;

    let waiting = false;    // 已点过下一项，等待新视频
    let idleRounds = 0;     // 连续几轮什么都没点
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      const v = findVideo();

      // 新视频真的在播了（时间戳和播完时明显不同）→ 完成
      const moved = startT < 0 ? (v && v.currentTime > 0.5) : (v && Math.abs(v.currentTime - startT) > 1);
      if (v && !v.paused && !v.ended && moved) {
        clearInterval(timer);
        flowRunning = false;
        recordStat('video', '完成一集', startT > 0 ? startT : 0);   // 学习记录
        promoteDraft();                                             // 草稿规则运行验证通过 → 转正
        lastAction = '已自动进入下一集';
        updateBadge();
        return;
      }
      // 超时兜底（40 秒）
      if (attempts > 20) {
        clearInterval(timer);
        flowRunning = false;
        const fb = fallbackToGeneric('切换超时（40 秒无新视频）');
        lastAction = '自动切换失败' + (fb ? '，草稿规则已回退通用模式（__autoLearn.diagnose() 看原因）' : '，请瞄一眼页面');
        updateBadge();
        return;
      }

      // 1) 先关收尾弹窗（评价/提示；关掉后允许重新点下一项）
      const modalBtn = findDialogDismiss();
      if (modalBtn) {
        clickEl(modalBtn);
        waiting = false;
        idleRounds = 0;
        lastAction = '已关闭收尾弹窗';
        updateBadge();
        return;
      }

      // 2) 点"下一项"：章节列表 → 选择器 → 文字按钮（最多点一次，点完等新视频）
      if (!waiting) {
        const chapter = findNextChapter();
        const entry = chapter || nextBySelector() || findByTexts(RULE.videoPage.next.texts) || findByTexts(RULE.videoPage.fallbackTexts);
        if (entry) {
          clickEl(entry);
          waiting = true;
          idleRounds = 0;
          if (chapter) {
            const nameSel = RULE.videoPage.next.nameSelector;
            const nameEl = nameSel ? chapter.querySelector(nameSel) : null;
            lastAction = '已点击下一章节：「' + (nameEl ? nameEl.textContent.trim().slice(0, 10) : '?') + '」';
          } else {
            lastAction = '已点击「' + (entry.innerText || '').trim().slice(0, 10) + '」';
          }
        } else {
          idleRounds++;
          if (idleRounds >= 5) {   // 约 10 秒什么都没得点 → 本课程播完
            clearInterval(timer);
            flowRunning = false;
            handleCourseFinished();
            return;
          }
        }
      }
      updateBadge();
    }, 2000);
  }

  /* 6.5 课程播完（没有下一项了）→ 标记完成 + 点返回 */
  function handleCourseFinished() {
    if (mode === 'traverse' && RULE.courseListPage) {
      if (currentCourseKey) {
        addDone(currentCourseKey);
        recordStat('course', '完成课程：' + currentCourseKey, 0);
      }
      promoteDraft();          // 遍历走到"无下一项"说明章节规则工作正常
      currentCourseKey = null;
      saveSession();
      const back = findBackButton();
      if (back) {
        clickEl(back);
        lastAction = '本课程播完，已点击返回列表';
      } else {
        lastAction = '本课程播完，但没找到返回按钮';
      }
    } else {
      if (RULE.draft) {
        const fb = fallbackToGeneric('单课模式找不到下一项（草稿规则可能不准）');
        lastAction = '没有可点的下一项' + (fb ? '，草稿规则已回退通用模式（__autoLearn.diagnose() 看原因）' : '（可能已全部播完）');
      } else {
        lastAction = '没有可点的下一项（可能已全部播完）';
      }
    }
    updateBadge();
  }

  function onEnded(e) {
    if (mode === 'off' || wizardOpen) return;
    if (!e.target || e.target.tagName !== 'VIDEO') return;
    lastAction = '本集结束，处理收尾…';
    updateBadge();
    startNextFlow();
  }

  /* 7. 核心心跳：续播 + 播完检测 + 遍历调度 + 刷新徽标 */
  function tick() {
    document.onvisibilitychange = null;
    document.onblur = null;
    window.onblur = null;

    /* 7.0 全自动建档：无规则的陌生平台，自动扫描生成草稿规则（最多尝试 6 轮） */
    if (mode !== 'off' && !draftAttempted) {
      draftTries++;
      const found = maybeAutoDraft();
      if (found || draftTries >= 6) draftAttempted = true;
    }

    const stallLimit = Math.max(2, Math.ceil((RULE.videoPage.completion.stallSeconds || 24) * 1000 / CFG.resumeMs));

    const v = findVideo();
    if (v) sawVideo = true;

    if (mode !== 'off' && !wizardOpen) {
      let triggered = false;   // 本轮是否触发了切换流程（触发时保留触发状态文案）
      if (v && !v.ended) {
        if (v.paused) {
          // 暂停 → 尝试续播（play 是异步的，结果下一轮复核）
          try {
            const p = v.play();
            if (p && p.catch) p.catch(() => {});
          } catch (e) {
            try { v.muted = true; v.play().catch(() => {}); } catch (e2) {}
          }
          const resumeBtn = findByTexts(CFG.resumeTexts);
          if (resumeBtn) clickEl(resumeBtn);
          resumeFails++;
          // 连续 ~24 秒都续播失败 → 按"播完"处理
          if (resumeFails >= 3) {
            resumeFails = 0;
            lastAction = '视频无法续播（疑似播完），尝试切换…';
            updateBadge();
            startNextFlow();
            triggered = true;
          }
        } else {
          // 播放中 → 时间戳卡住检测（部分播放器不触发 ended，靠这个兜底）
          resumeFails = 0;
          if (v.currentTime > 0) {
            if (v.currentTime === lastTime) {
              stallCount++;
              if (stallCount >= stallLimit) {
                stallCount = 0;
                lastAction = '播放疑似卡住/播完，尝试切换…';
                updateBadge();
                startNextFlow();
                triggered = true;
              }
            } else {
              stallCount = 0;
              lastTime = v.currentTime;
            }
          }
        }
        if (!triggered) {
          lastAction = v.paused
            ? '检测到暂停，尝试续播…'
            : '播放中 ' + fmt(v.currentTime) + ' / ' + fmt(v.duration);
        }
      } else if (v) {
        lastAction = '本集已结束，等待切换…';
      } else {
        lastAction = '页面里没有视频';
      }
    }

    /* 7.5 自动遍历调度：列表页 → 进课；视频页 → 正常连播（播完由 handleCourseFinished 返回） */
    if (mode === 'traverse' && !wizardOpen) {
      const r = RULE.courseListPage;
      if (r && r.courseItemSelector) {
        if (!v) {
          // 没有视频 → 视为列表页（或课程加载中）
          if (currentCourseKey) {
            // 已点过课程但还没出现视频：等 60 秒，超时清空重试
            if (Date.now() - enteredAt > 60000) {
              currentCourseKey = null;
              saveSession();
              lastAction = '进入课程超时，重新选择课程';
            } else {
              lastAction = '等待课程页面加载…';
            }
          } else {
            const item = findNextCourse();
            if (item) {
              if (traverseAttempts < (r.maxCoursesPerSession || 20)) {
                enterCourse(item);
              } else {
                lastAction = '已达到本轮进出上限（' + (r.maxCoursesPerSession || 20) + ' 门），停止遍历';
              }
            } else {
              lastAction = '全部课程已完成 🎉';
            }
          }
        }
        // 有视频：正常连播即可；课程播完由 handleCourseFinished 点返回
      }
    }

    if (sawVideo && !badge && document.body) makeBadge();
    updateBadge();
  }

  /* ---------------- 课程遍历工具 ---------------- */
  function courseKey(item) {
    const r = RULE.courseListPage;
    const nameEl = (r && r.nameSelector) ? item.querySelector(r.nameSelector) : null;
    const name = nameEl ? nameEl.textContent.trim().slice(0, 40) : '';
    if (name) return name;
    let items = [];
    try { items = Array.from(document.querySelectorAll(r.courseItemSelector)); } catch (e) {}
    return '#idx' + items.indexOf(item);
  }

  function findCourseItems() {
    const r = RULE.courseListPage;
    if (!r || !r.courseItemSelector) return [];
    try { return Array.from(document.querySelectorAll(r.courseItemSelector)); } catch (e) { return []; }
  }

  function isCourseDone(item) {
    const r = RULE.courseListPage;
    if (r.doneSelector) {
      try { if (item.querySelector(r.doneSelector)) return true; } catch (e) {}
    }
    if (r.doneTexts && r.doneTexts.length) {
      const t = (item.innerText || item.textContent || '').trim();
      if (r.doneTexts.some(x => t.includes(x))) return true;
    }
    return getDoneSet().indexOf(courseKey(item)) !== -1;
  }

  function findNextCourse() {
    for (const it of findCourseItems()) {
      if (!isVisible(it)) continue;
      if (!isCourseDone(it)) return it;
    }
    return null;
  }

  function enterCourse(item) {
    const r = RULE.courseListPage;
    let target = null;
    if (r.enterTexts && r.enterTexts.length) {
      const btn = Array.from(item.querySelectorAll('button, a, [role="button"], div, span')).find(el => {
        const t = (el.innerText || el.textContent || '').trim();
        return t && t.length <= 12 && r.enterTexts.some(x => t.includes(x));
      });
      if (btn) target = btn;
    }
    target = target || item;
    clickEl(target);
    currentCourseKey = courseKey(item);
    enteredAt = Date.now();
    traverseAttempts++;
    saveSession();
    lastAction = '进入课程：「' + (currentCourseKey || '?') + '」';
    updateBadge();
  }

  function findBackButton() {
    const r = RULE.courseListPage;
    if (!r) return null;
    if (r.backSelector) {
      try {
        const el = document.querySelector(r.backSelector);
        if (el && isVisible(el)) return el;
      } catch (e) {}
    }
    return findByTexts(r.backTexts);
  }

  /* ============================================================
   * 8. 录制向导（扫描 + 高亮 + 点选角色 + 生成规则 + 试运行）
   * ============================================================ */
  let wizardOpen = false;
  let wizardPanel = null;
  let hoverBox = null;
  let pickRole = null;   // 当前待分配的角色

  const wizState = {
    video: '', chapterItem: '', activeClass: '', activeDetected: false, skipClass: '',
    nextButton: '', nextButtonSel: '',
    dismissButton: '', dismissSel: '',
    backButton: '', backSel: '',
    courseItem: '', enterButton: '',
    doneMarker: ''
  };

  function cssOf(el) {
    if (!el || el.nodeType !== 1) return '';
    const tag = el.tagName.toLowerCase();
    if (tag === 'html' || tag === 'body') return tag;
    if (tag === 'video') return 'video';
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) {
      try { if (document.querySelectorAll('#' + el.id).length === 1) return '#' + el.id; } catch (e) {}
    }
    const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/)
      .filter(c => c && !/^(active|selected|current|hover|focus|open|show|hidden|is-|vjs-|el-)/.test(c));
    if (cls.length) return tag + '.' + cls.slice(0, 2).join('.');
    // 无 id/class → 路径兜底（最多 3 层）
    const path = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== 'body' && path.length < 3) {
      const p = cur.parentElement;
      if (!p) break;
      path.unshift(cur.tagName.toLowerCase() + ':nth-child(' + (Array.prototype.indexOf.call(p.children, cur) + 1) + ')');
      cur = p;
    }
    return path.join(' > ');
  }

  /* 列表项角色：从点击的任意子元素向上定位到"行容器"
     （类名像列表项、不是文字叶子标签、有子元素、且同类元素 ≥2 个）
     —— 要求"有子元素"是为了跳过行内的标题/名字等内层元素，定位到真正的行容器 */
  function pickListItem(el) {
    const KEY = /item|wrapper|chapter|card|course|lesson|list|row|cell|unit|video/i;
    const LEAF = /^(span|i|b|em|strong|small|p|h[1-6])$/;
    let cur = el;
    for (let i = 0; i < 6 && cur && cur !== document.body; i++) {
      const tag = cur.tagName.toLowerCase();
      const cls = typeof cur.className === 'string' ? cur.className : '';
      if (cls && KEY.test(cls) && !LEAF.test(tag) && cur.children.length > 0) {
        const sel = cssOf(cur);
        let n = 0;
        try { n = document.querySelectorAll(sel).length; } catch (e) {}
        if (n >= 2) return cur;
      }
      cur = cur.parentElement;
    }
    // 兜底：向上找第一个"非叶子标签且同类 ≥2"的元素（适配"行内无子元素"的平台）
    cur = el;
    for (let i = 0; i < 6 && cur && cur !== document.body; i++) {
      if (!LEAF.test(cur.tagName.toLowerCase())) {
        const sel = cssOf(cur);
        let n = 0;
        try { n = document.querySelectorAll(sel).length; } catch (e) {}
        if (n >= 2) return cur;
      }
      cur = cur.parentElement;
    }
    return el;
  }

  /* 按钮类角色：从按钮内的文字/图标向上定位到按钮元素 */
  function pickButton(el) {
    let cur = el;
    for (let i = 0; i < 4 && cur && cur !== document.body; i++) {
      const tag = cur.tagName.toLowerCase();
      if (tag === 'button' || tag === 'a' || cur.getAttribute('role') === 'button') return cur;
      cur = cur.parentElement;
    }
    return el;
  }

  /* 自动识别"当前项"标记 class：所有匹配项里恰好出现 1 次、且名字像状态类的 */
  function detectActiveClass(sel) {
    let els = [];
    try { els = Array.from(document.querySelectorAll(sel)); } catch (e) { return null; }
    if (els.length < 2) return null;
    const counts = new Map();
    for (const el of els) {
      for (const c of el.classList) counts.set(c, (counts.get(c) || 0) + 1);
    }
    const hit = Array.from(counts.keys()).find(c =>
      counts.get(c) === 1 && /active|current|playing|selected|chosen|on|focus/i.test(c)
    );
    return hit || null;
  }

  /* 自动识别"跳过项"class：出现在部分（非全部）项上、名字不像状态类的 */
  function detectSkipClass(sel) {
    let els = [];
    try { els = Array.from(document.querySelectorAll(sel)); } catch (e) { return ''; }
    const total = els.length;
    if (total < 3) return '';
    const counts = new Map();
    for (const el of els) {
      for (const c of el.classList) counts.set(c, (counts.get(c) || 0) + 1);
    }
    const hit = Array.from(counts.keys()).find(c =>
      counts.get(c) > 1 && counts.get(c) < total &&
      !/active|current|playing|selected|chosen|on|focus|hover|open|show|hidden/i.test(c) &&
      !/^vjs-/.test(c) && !/^el-/.test(c)
    );
    return hit || '';
  }

  function injectWizardStyle() {
    if (document.getElementById('alw-style')) return;
    const style = document.createElement('style');
    style.id = 'alw-style';
    style.textContent =
      '#auto-learn-wizard{position:fixed;right:12px;top:64px;z-index:2147483646;width:320px;' +
      'background:#0f192b;color:#cfd8e3;font:12px/1.7 "Microsoft YaHei",sans-serif;' +
      'border:1px solid #2c4a63;border-radius:8px;padding:12px;box-shadow:0 4px 20px rgba(0,0,0,.5);}' +
      '#auto-learn-wizard .alw-role{display:block;width:100%;text-align:left;margin:4px 0;padding:5px 8px;' +
      'background:#16273c;color:#cfd8e3;border:1px solid #2c4a63;border-radius:5px;cursor:pointer;}' +
      '#auto-learn-wizard .alw-role:hover{border-color:#7fd4ff;}' +
      '#auto-learn-wizard .alw-role.picking{border-color:#ffd76e;color:#ffd76e;}' +
      '#auto-learn-wizard .alw-role.done{border-color:#4acd7d;}' +
      '#auto-learn-wizard .alw-val{color:#9fb6c9;font-size:11px;}' +
      '#auto-learn-wizard .alw-actions{display:flex;gap:6px;margin-top:10px;}' +
      '#auto-learn-wizard button.alw-act{flex:1;padding:6px 0;background:#1d6f42;color:#eafff1;border:0;border-radius:5px;cursor:pointer;}' +
      '#auto-learn-wizard button.alw-act.gray{background:#37475b;color:#cfd8e3;}' +
      '#auto-learn-hoverbox{position:fixed;z-index:2147483645;border:2px solid #ffd76e;' +
      'background:rgba(255,215,110,.12);pointer-events:none;display:none;}' +
      '#alw-result{margin:8px 0 0;padding:6px;background:#0b1420;border:1px solid #2c4a63;' +
      'border-radius:5px;white-space:pre-wrap;color:#8fe3a8;font-size:11px;}';
    (document.head || document.documentElement).appendChild(style);
  }

  function openWizard() {
    if (wizardOpen) return;
    injectWizardStyle();
    if (!document.body) return;

    hoverBox = document.createElement('div');
    hoverBox.id = 'auto-learn-hoverbox';
    document.body.appendChild(hoverBox);

    wizardPanel = document.createElement('div');
    wizardPanel.id = 'auto-learn-wizard';
    wizardPanel.innerHTML =
      '<h3 style="margin:0 0 8px;font-size:13px;color:#7fd4ff;">🎯 录制向导</h3>' +
      '<div style="font-size:11px;color:#9fb6c9;margin-bottom:6px;">先点一个角色按钮，再去页面上点对应的元素（悬停有黄色高亮框）</div>' +
      '<button class="alw-role" data-role="video">① 视频元素 <span class="alw-val">—</span></button>' +
      '<button class="alw-role" data-role="chapterItem">② 章节项（点当前播放中的那个） <span class="alw-val">—</span></button>' +
      '<button class="alw-role" data-role="nextButton">③ 下一集按钮（可选） <span class="alw-val">—</span></button>' +
      '<button class="alw-role" data-role="dismissButton">④ 关弹窗按钮（如"取消"） <span class="alw-val">—</span></button>' +
      '<button class="alw-role" data-role="backButton">⑤ 返回列表按钮 <span class="alw-val">—</span></button>' +
      '<button class="alw-role" data-role="courseItem">⑥ 课程项（课程列表页） <span class="alw-val">—</span></button>' +
      '<button class="alw-role" data-role="enterButton">⑦ 进入课程按钮（可选） <span class="alw-val">—</span></button>' +
      '<button class="alw-role" data-role="doneMarker">⑧ 完成标记（可选） <span class="alw-val">—</span></button>' +
      '<div class="alw-actions">' +
      '<button class="alw-act gray" data-act="cancelPick">取消拾取</button>' +
      '<button class="alw-act" data-act="generate">生成规则并试运行</button>' +
      '<button class="alw-act gray" data-act="close">关闭</button>' +
      '</div>' +
      '<pre id="alw-result" style="display:none;"></pre>';
    document.body.appendChild(wizardPanel);

    wizardPanel.addEventListener('click', ev => {
      const roleBtn = ev.target.closest('[data-role]');
      if (roleBtn) { startPick(roleBtn.getAttribute('data-role')); return; }
      const actBtn = ev.target.closest('[data-act]');
      if (!actBtn) return;
      const act = actBtn.getAttribute('data-act');
      if (act === 'cancelPick') { pickRole = null; hoverBox.style.display = 'none'; refreshPanel(); }
      else if (act === 'generate') generateRule();
      else if (act === 'close') closeWizard();
    });

    document.addEventListener('mousemove', onWizardHover, true);
    document.addEventListener('click', onWizardPick, true);
    wizardOpen = true;
    refreshPanel();
  }

  function closeWizard() {
    wizardOpen = false;
    pickRole = null;
    document.removeEventListener('mousemove', onWizardHover, true);
    document.removeEventListener('click', onWizardPick, true);
    if (hoverBox) { hoverBox.remove(); hoverBox = null; }
    if (wizardPanel) { wizardPanel.remove(); wizardPanel = null; }
  }

  function startPick(role) {
    pickRole = role;
    refreshPanel();
  }

  function onWizardHover(e) {
    if (!pickRole || !hoverBox) return;
    const el = e.target;
    if ((wizardPanel && wizardPanel.contains(el)) || (badge && badge.contains(el))) {
      hoverBox.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) { hoverBox.style.display = 'none'; return; }
    hoverBox.style.left = r.left + 'px';
    hoverBox.style.top = r.top + 'px';
    hoverBox.style.width = r.width + 'px';
    hoverBox.style.height = r.height + 'px';
    hoverBox.style.display = 'block';
  }

  function onWizardPick(e) {
    if (!pickRole) return;
    if (wizardPanel && wizardPanel.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    assignRole(pickRole, el);
    pickRole = null;
    if (hoverBox) hoverBox.style.display = 'none';
    refreshPanel();
  }

  function assignRole(role, el) {
    // 先按角色定位到"合适"的元素：列表项→行容器；按钮→按钮元素；视频→<video>
    if (role === 'video' && el.tagName !== 'VIDEO') {
      try { el = el.querySelector('video') || el.closest('video') || el; } catch (e) {}
    } else if (role === 'chapterItem' || role === 'courseItem') {
      el = pickListItem(el);
    } else if (role === 'nextButton' || role === 'dismissButton' || role === 'backButton' || role === 'enterButton') {
      el = pickButton(el);
    }
    const sel = cssOf(el);
    switch (role) {
      case 'video': wizState.video = sel; break;
      case 'chapterItem':
        wizState.chapterItem = sel;
        wizState.activeClass = detectActiveClass(sel) || '';
        wizState.activeDetected = !!wizState.activeClass;
        wizState.skipClass = detectSkipClass(sel);
        break;
      case 'nextButton':
        wizState.nextButton = (el.innerText || el.textContent || '').trim().slice(0, 12);
        wizState.nextButtonSel = sel;
        break;
      case 'dismissButton':
        wizState.dismissButton = (el.innerText || el.textContent || '').trim().slice(0, 12);
        wizState.dismissSel = sel;
        break;
      case 'backButton':
        wizState.backButton = (el.innerText || el.textContent || '').trim().slice(0, 12);
        wizState.backSel = sel;
        break;
      case 'courseItem': wizState.courseItem = sel; break;
      case 'enterButton': wizState.enterButton = (el.innerText || el.textContent || '').trim().slice(0, 12); break;
      case 'doneMarker': wizState.doneMarker = sel; break;
    }
  }

  function refreshPanel() {
    if (!wizardPanel) return;
    const vals = {
      video: wizState.video || '—',
      chapterItem: wizState.chapterItem
        ? (wizState.chapterItem + ' · active=' + (wizState.activeClass || '⚠未识别') + (wizState.skipClass ? ' · skip=' + wizState.skipClass : ''))
        : '—',
      nextButton: wizState.nextButton || wizState.nextButtonSel || '—',
      dismissButton: wizState.dismissButton || wizState.dismissSel || '—',
      backButton: wizState.backButton || wizState.backSel || '—',
      courseItem: wizState.courseItem || '—',
      enterButton: wizState.enterButton || '—',
      doneMarker: wizState.doneMarker || '—'
    };
    wizardPanel.querySelectorAll('.alw-role').forEach(btn => {
      const role = btn.getAttribute('data-role');
      btn.querySelector('.alw-val').textContent = vals[role];
      btn.classList.toggle('done', vals[role] !== '—');
      btn.classList.toggle('picking', pickRole === role);
    });
  }

  function generateRule() {
    const chapter = wizState.chapterItem;
    const course = wizState.courseItem;
    const prev = RULE;                 // 现有规则（内置/已保存）
    const prevNext = prev.videoPage.next;
    const prevLp = prev.courseListPage;

    // 只覆盖"拾取过的"字段，其余保留现有规则，避免向导误清掉内置配置
    const dialogs = (wizState.dismissButton || wizState.dismissSel)
      ? [{ selector: wizState.dismissSel || '', dismissTexts: wizState.dismissButton ? [wizState.dismissButton] : [] }]
      : (prev.videoPage.dialogs && prev.videoPage.dialogs.length
          ? prev.videoPage.dialogs
          : [{ selector: '', dismissTexts: ['取消', '关闭'] }]);

    const rule = {
      name: (prev.name && prev.name !== '通用模式' && prev.name !== '未命名规则') ? prev.name : '向导生成规则',
      videoPage: {
        videoSelector: wizState.video || prev.videoPage.videoSelector,
        next: chapter ? {
          strategy: 'chapter-list',
          listSelector: chapter,
          activeClass: wizState.activeClass || 'active',
          skipClass: wizState.skipClass || '',
          nameSelector: prevNext.nameSelector || '',
          selector: '',
          texts: []
        } : (wizState.nextButton || wizState.nextButtonSel ? {
          strategy: 'button',
          listSelector: '',
          activeClass: 'active',
          skipClass: '',
          nameSelector: '',
          selector: wizState.nextButtonSel,
          texts: wizState.nextButton ? [wizState.nextButton] : []
        } : prevNext),
        fallbackTexts: prev.videoPage.fallbackTexts,
        dialogs: dialogs,
        completion: { stallSeconds: (prev.videoPage.completion && prev.videoPage.completion.stallSeconds) || 24 }
      },
      courseListPage: course ? {
        courseItemSelector: course,
        nameSelector: prevLp ? prevLp.nameSelector : '',
        enterTexts: wizState.enterButton ? [wizState.enterButton] : (prevLp ? prevLp.enterTexts : []),
        doneSelector: wizState.doneMarker || (prevLp ? prevLp.doneSelector : ''),
        doneTexts: prevLp ? prevLp.doneTexts : [],
        backSelector: wizState.backButton ? '' : (wizState.backSel || (prevLp ? prevLp.backSelector : '')),
        backTexts: wizState.backButton
          ? [wizState.backButton]
          : (prevLp && prevLp.backTexts && prevLp.backTexts.length ? prevLp.backTexts : ['返回']),
        maxCoursesPerSession: prevLp ? prevLp.maxCoursesPerSession : 20
      } : prev.courseListPage
    };

    const saveMsg = window.__autoLearn.saveRule(rule);

    // 试运行检查
    const checks = [saveMsg];
    checks.push('视频匹配: ' + (findVideo() ? '✓ 找到视频' : '✗ 当前页没有视频（正常）'));
    if (chapter) {
      let n = 0;
      try { n = document.querySelectorAll(chapter).length; } catch (e) {}
      checks.push('章节项数量: ' + n + (n >= 2 ? ' ✓' : ' ⚠ 太少，可能选错了'));
      const act = findNextChapter();
      checks.push('下一章节: ' + (act ? '✓ 找到' : '⚠ 没找到（可能已到最后一集/没有active标记）'));
    }
    if (course) {
      let n = 0;
      try { n = document.querySelectorAll(course).length; } catch (e) {}
      checks.push('课程项数量: ' + n + (n >= 1 ? ' ✓' : ' ⚠ 当前页可能不是列表页'));
    }
    if (RULE.courseListPage) {
      checks.push('返回按钮: ' + (findBackButton() ? '✓ 找到' : '⚠ 当前页没找到（视频页上才算数）'));
    }
    checks.push('规则已存 localStorage：autoLearn.rule.' + location.hostname);

    const resultEl = wizardPanel && wizardPanel.querySelector('#alw-result');
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.textContent = checks.join('\n');
    }
    console.log('[auto-learn] 生成规则：\n' + JSON.stringify(rule, null, 2) + '\n\n试运行：\n' + checks.join('\n'));
    return checks;
  }

  /* 8.5 学习记录日报/周报 + 诊断报告 */
  function buildReport() {
    const s = loadStats();
    const day = todayKey();
    const t = s.days[day] || { videos: 0, seconds: 0 };
    const lines = [
      '## 学习记录（' + location.hostname + '）',
      '时间：' + new Date().toLocaleString(),
      '今日：' + t.videos + ' 集 · ' + Math.round(t.seconds / 60) + ' 分钟',
      '累计：' + s.videos + ' 集 · ' + Math.round(s.seconds / 60) + ' 分钟 · 完成课程 ' + s.courses + ' 门',
      '近 7 天：'
    ];
    const days = Object.keys(s.days).sort().slice(-7);
    for (const k of days) {
      lines.push('  ' + k + '：' + s.days[k].videos + ' 集 · ' + Math.round(s.days[k].seconds / 60) + ' 分钟');
    }
    lines.push('最近活动：');
    for (const e of s.log.slice(-8).reverse()) {
      lines.push('  [' + new Date(e.t).toLocaleTimeString() + '] ' + e.type + ' ' + e.detail);
    }
    return lines.join('\n');
  }

  function buildDiagnose() {
    const st = loadStats();
    const fails = st.log.filter(e => e.type === 'fail').slice(-10);
    const scan = JSON.parse(window.__autoLearn.scan());
    const v = findVideo();
    const lines = [
      '## 诊断报告（' + location.hostname + '）',
      '时间：' + new Date().toLocaleString() + '　模式：' + mode + '　草稿规则：' + (RULE.draft ? '是' : '否'),
      '',
      '### 当前规则',
      JSON.stringify(RULE, null, 2),
      '',
      '### 最近失败记录',
      fails.length ? fails.map(e => new Date(e.t).toLocaleTimeString() + '  ' + e.detail).join('\n') : '（无）',
      '',
      '### 页面扫描摘要',
      '视频元素：' + scan.videos,
      '列表候选：' + (scan.listCandidates && scan.listCandidates.length
        ? scan.listCandidates.map(c => c.childSig + ' x' + c.childCount).join('、')
        : '无'),
      '按钮：' + ((scan.buttons || []).join('、') || '无'),
      '',
      '### 视频状态',
      v ? ('ended=' + v.ended + ' paused=' + v.paused + ' time=' + v.currentTime + ' duration=' + v.duration) : '无视频'
    ];
    return lines.join('\n');
  }

  /* 9. 规则管理 API + 页面扫描助手（F12 控制台用） */
  window.__autoLearn = {
    help: () => 'getRule() 查看规则 | saveRule({...}) 保存 | clearRule() 清除 | exportRules() 导出 | ' +
      'importRules(\'{...}\') 导入 | setMode(\'single|traverse|off\') 切模式 | scan() 扫页面 | ' +
      'wizard() 录制向导 | report() 学习日报 | diagnose() 诊断 | clearDone() 清完成记录 | clearStats() 清学习记录',
    getRule: () => JSON.parse(JSON.stringify(RULE)),
    saveRule: rule => {
      if (!rule || typeof rule !== 'object') return '用法：__autoLearn.saveRule({ name, videoPage: {...}, courseListPage: {...} })';
      try {
        localStorage.setItem(PREFIX + location.hostname, JSON.stringify(normalizeRule(rule)));
      } catch (e) { return '保存失败：' + e.message; }
      RULE = getRule();
      lastAction = '规则已更新：' + RULE.name;
      return '已保存并生效：' + RULE.name;
    },
    clearRule: () => {
      try { localStorage.removeItem(PREFIX + location.hostname); } catch (e) { return '删除失败：' + e.message; }
      RULE = getRule();
      return '已删除本域自定义规则，当前使用：' + RULE.name;
    },
    exportRules: () => {
      const out = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf(PREFIX) === 0) {
            try { out[k.slice(PREFIX.length)] = JSON.parse(localStorage.getItem(k)); } catch (e) {}
          }
        }
      } catch (e) {}
      return JSON.stringify(out, null, 2);
    },
    importRules: json => {
      let obj;
      try { obj = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return 'JSON 解析失败：' + e.message; }
      if (!obj || typeof obj !== 'object') return '格式应为 {域名: 规则对象, ...}';
      let n = 0;
      for (const k of Object.keys(obj)) {
        try { localStorage.setItem(PREFIX + k, JSON.stringify(normalizeRule(obj[k]))); n++; } catch (e) {}
      }
      RULE = getRule();
      return '已导入 ' + n + ' 条规则';
    },
    setMode: m => setMode(m),
    getMode: () => mode,
    clearDone: () => {
      try { sessionStorage.removeItem(DONE_KEY); } catch (e) {}
      return '已清空本域"已完成课程"记录';
    },
    report: () => buildReport(),
    diagnose: () => buildDiagnose(),
    clearStats: () => {
      try { localStorage.removeItem(STATS_KEY); } catch (e) {}
      return '已清空本域学习记录';
    },
    wizard: arg => {
      if (arg === 'close') { closeWizard(); return '已关闭'; }
      if (wizardOpen) { closeWizard(); return '已关闭'; }
      openWizard();
      return wizardOpen ? '录制向导已打开：先点角色按钮，再点页面元素' : '页面还没加载完，稍等再试';
    },
    /* 页面结构扫描助手：帮你写出规则（录制向导的文本版） */
    scan: () => {
      const out = { videos: Array.from(document.querySelectorAll('video')).length, listCandidates: [], buttons: [] };
      const parents = new Map();
      document.querySelectorAll('div, ul, ol, section').forEach(p => {
        if (p.children.length < 3 || p.children.length > 80) return;
        const sigs = {};
        for (const c of p.children) {
          const cls = (c.className && typeof c.className === 'string') ? c.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
          const sig = c.tagName.toLowerCase() + (cls ? '.' + cls : '');
          sigs[sig] = (sigs[sig] || 0) + 1;
        }
        let top = null;
        for (const k of Object.keys(sigs)) {
          if (!top || sigs[k] > top[1]) top = [k, sigs[k]];
        }
        if (top && top[1] >= 3) parents.set(p, top);
      });
      out.listCandidates = Array.from(parents.entries()).slice(0, 6).map(([p, [sig, count]]) => ({
        containerClass: (p.className && typeof p.className === 'string') ? p.className.trim().split(/\s+/).slice(0, 3).join('.') : '',
        containerTag: p.tagName.toLowerCase(),
        childSig: sig,
        childCount: count,
        sample: (p.outerHTML || '').slice(0, 400)
      }));
      out.buttons = Array.from(document.querySelectorAll('button, a'))
        .map(e => (e.innerText || e.textContent || '').trim())
        .filter(t => t && t.length <= 12)
        .filter((t, i, arr) => arr.indexOf(t) === i)
        .slice(0, 40);
      return JSON.stringify(out, null, 2);
    }
  };

  /* 9.5 内部调试接口（测试/排查用） */
  window.__autoLearn._t = {
    findVideo, findNextChapter, nextBySelector, findNextCourse, isCourseDone, courseKey,
    enterCourse, findBackButton,
    pickListItem, pickButton, cssOf, detectActiveClass, detectSkipClass,
    assignRole, generateRule,
    setMode, tick, startNextFlow, handleCourseFinished,
    maybeAutoDraft, promoteDraft, fallbackToGeneric, recordStat, loadStats, getTodayStats,
    getRule: () => JSON.parse(JSON.stringify(RULE)),
    status: () => lastAction
  };

  /* 10. 启动 */
  document.addEventListener('ended', onEnded, true); // 捕获阶段监听，站点拦不住
  setInterval(fakeActivity, CFG.fakeActivityMs);
  setInterval(tick, CFG.resumeMs);
  document.addEventListener('DOMContentLoaded', makeBadge);
  showToast('✅ 自动播放 v1.6 已注入 — 这是学习平台将自动开始；普通页面无动作。右下角徽标可暂停/切模式。');
  console.log('[auto-learn v1.6] 已注入。当前域名规则：' + RULE.name + (RULE.draft ? '（草稿）' : '') +
    '，模式：' + mode + '（控制台输入 __autoLearn.help() 查看命令）');
})();
