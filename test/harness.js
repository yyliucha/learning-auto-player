/* 冒烟测试：用最小 DOM mock 加载 auto-learn.user.js，验证核心逻辑。
 * 运行：node test/harness.js   （无第三方依赖）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'auto-learn.user.js'), 'utf8');

/* ---------------- 最小 DOM mock ---------------- */
class FakeEl {
  constructor(tag, className = '', attrs = {}) {
    this.tagName = tag.toUpperCase();
    this._class = className;
    this.attrs = Object.assign({}, attrs);
    this.children = [];
    this.parentElement = null;
    this._text = '';
  }
  get className() { return this._class; }
  set className(v) { this._class = String(v); }
  get nodeType() { return 1; }   // 元素节点（cssOf 依赖此判断）
  get classList() {
    const self = this;
    return {
      contains: c => self._class.split(/\s+/).includes(c),
      [Symbol.iterator]: function* () { yield* self._class.split(/\s+/).filter(Boolean); }
    };
  }
  get innerText() {
    let s = this._text;
    for (const c of this.children) s += ' ' + c.innerText;
    return s;
  }
  set innerText(v) { this._text = String(v); }
  get textContent() { return this.innerText; }
  get offsetParent() { return undefined; }   // undefined !== null → isVisible 判为可见
  getClientRects() { return [{ length: 1 }]; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 30 }; }
  getAttribute(name) { return this.attrs[name]; }
  get id() { return this.attrs.id; }
  set id(v) { this.attrs.id = v; }
  get style() { if (!this._style) this._style = {}; return this._style; }
  set textContent(v) { this._text = String(v); }
  append(...els) { for (const e of els) { e.parentElement = this; this.children.push(e); } return this; }
  appendChild(el) { return this.append(el); }
  addEventListener() {}
  contains(other) { let cur = other; while (cur) { if (cur === this) return true; cur = cur.parentElement; } return false; }
  walk(fn) {
    if (fn(this)) return this;
    for (const c of this.children) { const hit = c.walk(fn); if (hit) return hit; }
    return null;
  }
  querySelector(sel) { return this.walk(el => el !== this && matchesSingle(el, sel)) || null; }
  querySelectorAll(sel) {
    const out = [];
    this.walk(el => { if (el !== this && matchesFull(el, sel)) out.push(el); return null; });
    return out;
  }
}

/* 视频元素 mock */
class FakeVideo extends FakeEl {
  constructor() {
    super('video', 'vjs-tech');
    this.ended = false;
    this.paused = true;
    this.currentTime = 0;
    this.duration = 306;
    this.muted = false;
  }
  play() { this.paused = false; return Promise.resolve(); }
}

/* CSS 匹配器（支持 tag / .class / #id / [attr] / 后代组合 / 逗号列表） */
function matchSimple(el, sel) {
  let s = sel.trim();
  const attrs = {};
  const attrRe = /\[([\w-]+)(?:=['"]?([^'"\]]*)['"]?)?\]/g;
  s = s.replace(attrRe, (m, name, val) => { attrs[name] = val === undefined ? true : val; return ''; });
  if (s) {
    if (s.startsWith('#')) return el.attrs.id === s.slice(1);
    const parts = s.split('.');
    const tag = parts[0];
    const classes = parts.slice(1);
    if (tag && el.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    for (const c of classes) if (!el.classList.contains(c)) return false;
  }
  for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    const actual = el.attrs[k];
    if (v === true) { if (actual === undefined) return false; }
    else if (actual !== v) return false;
  }
  return true;
}

function matchesSingle(el, sel) {
  const parts = sel.split(/\s+/).filter(p => p && p !== '>');
  if (!parts.length) return false;
  if (!matchSimple(el, parts[parts.length - 1])) return false;
  let idx = parts.length - 2;
  let cur = el.parentElement;
  while (cur && idx >= 0) {
    if (matchSimple(cur, parts[idx])) idx--;
    cur = cur.parentElement;
  }
  return idx < 0;
}

function matchesFull(el, sel) {
  return sel.split(',').some(s => matchesSingle(el, s.trim()));
}

function makeDoc() {
  const body = new FakeEl('body');
  const head = new FakeEl('head');
  const html = new FakeEl('html');
  html.append(head, body);
  return {
    body, head, documentElement: html,
    addEventListener() {}, dispatchEvent() {},
    createElement(tag) { return new FakeEl(tag); },
    querySelector(sel) {
      if (matchesFull(body, sel)) return body;
      return body.querySelector(sel) || (matchesFull(head, sel) ? head : null);
    },
    querySelectorAll(sel) {
      const out = [];
      if (matchesFull(body, sel)) out.push(body);
      for (const x of body.querySelectorAll(sel)) out.push(x);
      return out;
    }
  };
}

function makeStore() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    key: i => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; }
  };
}

/* ---------------- 加载脚本（一次加载 = 一个独立实例） ---------------- */
function loadScript({ localStorage, sessionStorage, hostname } = {}) {
  const doc = makeDoc();
  const win = { __AUTO_LEARN__: false, innerWidth: 1920, innerHeight: 1080, addEventListener() {}, dispatchEvent() {} };
  class EventTarget { addEventListener() {} }
  class MouseEvent { constructor(type, opts) { this.type = type; Object.assign(this, opts); } }
  class KeyboardEvent { constructor(type, opts) { this.type = type; Object.assign(this, opts); } }
  const location = { hostname: hostname || 'example.com' };
  const ls = localStorage || makeStore();
  const ss = sessionStorage || makeStore();
  const timers = [];   // 收集 setInterval 注册的定时器，测试时手动触发
  const fn = new Function(
    'window', 'document', 'location', 'EventTarget', 'MouseEvent', 'KeyboardEvent',
    'localStorage', 'sessionStorage', 'setInterval', 'setTimeout',
    SCRIPT + '\n;return window;'
  );
  const winOut = fn(win, doc, location, EventTarget, MouseEvent, KeyboardEvent, ls, ss,
    (f, ms) => { timers.push({ f, ms }); return timers.length; }, () => 0);
  return { win: winOut, doc, localStorage: ls, sessionStorage: ss, timers };
}

/* ---------------- 测试 ---------------- */
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('✓ ' + name); }
  catch (e) { failed++; console.error('✗ ' + name + '\n  ' + (e && e.message)); }
}

/* 场景 1：无存储 → 内置示例规则 */
const A = loadScript();
const t1 = A.win.__autoLearn._t;

test('内置规则解析（示例平台）', () => {
  const r = t1.getRule();
  assert.strictEqual(r.name, '示例学习平台');
  assert.strictEqual(r.videoPage.next.strategy, 'chapter-list');
  assert.strictEqual(r.videoPage.next.listSelector, '.chapter-item .item-wrapper');
  assert.strictEqual(r.videoPage.next.activeClass, 'active');
  assert.strictEqual(r.videoPage.next.skipClass, 'no-video');
  assert.strictEqual(r.courseListPage.backSelector, '.back-btn');
  assert.strictEqual(r.courseListPage.courseItemSelector, '');
});

/* 构造章节树：3 个分组，active 在 2.2，下一项应为 3.1（跳过 no-video 标题） */
function buildChapterTree() {
  const tree = new FakeEl('div', 'chapter-tree-player');
  const mkItem = (level, num, name, extra = '') => {
    const item = new FakeEl('div', 'chapter-item level-' + level);
    const wrap = new FakeEl('div', 'item-wrapper' + extra);
    const n = new FakeEl('span', 'chapter-number');
    n.innerText = num;
    const t = new FakeEl('span', 'chapter-name');
    t.innerText = name;
    wrap.append(n, t);
    item.append(wrap);
    return { item, wrap };
  };
  const g1 = new FakeEl('div', 'chapter-group');
  g1.append(mkItem(1, '1', '信息安全意识教育', ' no-video').item);
  g1.append(mkItem(2, '1.1', '为什么要进行示例课程？').item);
  g1.append(mkItem(2, '1.2', '示例课程介绍').item);
  const g2 = new FakeEl('div', 'chapter-group');
  g2.append(mkItem(1, '2', '数据安全管理', ' no-video').item);
  g2.append(mkItem(2, '2.1', '数据分级分类介绍').item);
  const a22 = mkItem(2, '2.2', '数据的使用和授权', ' active');
  g2.append(a22.item);
  const g3 = new FakeEl('div', 'chapter-group');
  g3.append(mkItem(1, '3', '物理和环境安全管理', ' no-video').item);
  const a31 = mkItem(2, '3.1', '物理安全');
  g3.append(a31.item);
  tree.append(g1, g2, g3);
  A.doc.body.append(tree);
  return { tree, w22: a22.wrap, w31: a31.wrap, name22: a22.wrap.querySelector('span.chapter-name') };
}
const CH = buildChapterTree();

test('findNextChapter：从 2.2(active) 跳到 3.1，跳过 no-video 标题', () => {
  assert.strictEqual(t1.findNextChapter(), CH.w31);
});

test('cssOf：video 特殊处理、状态类被过滤', () => {
  assert.strictEqual(t1.cssOf(new FakeEl('video', 'vjs-tech')), 'video');
  assert.strictEqual(t1.cssOf(CH.w22), 'div.item-wrapper');
});

test('detectActiveClass / detectSkipClass 自动识别', () => {
  assert.strictEqual(t1.detectActiveClass('div.item-wrapper'), 'active');
  assert.strictEqual(t1.detectSkipClass('div.item-wrapper'), 'no-video');
});

test('pickListItem：从章节名 span 向上定位到行容器', () => {
  assert.strictEqual(t1.pickListItem(CH.name22), CH.w22);
});

test('pickButton：从图标 i 向上定位到按钮', () => {
  const btn = new FakeEl('button', 'back-btn');
  const icon = new FakeEl('i', 'el-icon-arrow-left');
  btn.append(icon);
  A.doc.body.append(btn);
  assert.strictEqual(t1.pickButton(icon), btn);
});

/* 场景 2：预置存储 → 自定义规则 + 完成记录 → 遍历选课 */
const RULE_JSON = {
  name: '测试规则',
  videoPage: {
    videoSelector: 'video',
    next: { strategy: 'chapter-list', listSelector: '.chapter-item .item-wrapper', activeClass: 'active', skipClass: 'no-video', nameSelector: '.chapter-name', texts: [], selector: '' },
    fallbackTexts: ['下一课'],
    dialogs: [{ selector: '', dismissTexts: ['取消'] }],
    completion: { stallSeconds: 24 }
  },
  courseListPage: {
    courseItemSelector: '.course-card',
    nameSelector: '.course-name',
    enterTexts: ['开始学习'],
    doneSelector: '',
    doneTexts: ['已完成'],
    backSelector: '.back-btn',
    backTexts: ['返回'],
    maxCoursesPerSession: 20
  }
};

const ls2 = makeStore();
const ss2 = makeStore();
ls2.setItem('autoLearn.rule.example.com', JSON.stringify(RULE_JSON));
ss2.setItem('autoLearn.done.example.com', JSON.stringify(['示例课程']));

const B = loadScript({ localStorage: ls2, sessionStorage: ss2 });
const t2 = B.win.__autoLearn._t;
const api2 = B.win.__autoLearn;

test('自定义规则从 localStorage 加载并规范化', () => {
  const r = t2.getRule();
  assert.strictEqual(r.name, '测试规则');
  assert.strictEqual(r.videoPage.next.selector, '');
  assert.strictEqual(r.courseListPage.courseItemSelector, '.course-card');
});

/* 构造课程列表：卡1在完成记录里、卡2带"已完成"文字、卡3空闲 */
function buildCourseList() {
  const list = new FakeEl('div', 'course-list');
  const mk = (name, extraText) => {
    const card = new FakeEl('div', 'course-card');
    const n = new FakeEl('div', 'course-name');
    n.innerText = name;
    card.append(n);
    if (extraText) {
      const badge = new FakeEl('div', 'done-badge');
      badge.innerText = extraText;
      card.append(badge);
    }
    list.append(card);
    return card;
  };
  const c1 = mk('示例课程');
  const c2 = mk('数据安全管理', '已完成');
  const c3 = mk('网络通信安全管理');
  B.doc.body.append(list);
  return { c1, c2, c3 };
}
const CL = buildCourseList();

test('isCourseDone：完成记录 + doneTexts 双通道', () => {
  assert.strictEqual(t2.isCourseDone(CL.c1), true);   // 在 sessionStorage 完成记录里
  assert.strictEqual(t2.isCourseDone(CL.c2), true);   // 卡片文字含"已完成"
  assert.strictEqual(t2.isCourseDone(CL.c3), false);  // 空闲
});

test('findNextCourse：自动选到第一门未完成课程', () => {
  assert.strictEqual(t2.findNextCourse(), CL.c3);
});

test('saveRule / setMode API', () => {
  const msg = api2.saveRule({ name: '新规则', videoPage: {} });
  assert.ok(String(msg).includes('新规则'));
  assert.strictEqual(t2.getRule().name, '新规则');
  assert.ok(String(api2.setMode('bad')).includes('模式无效'));
  assert.strictEqual(api2.setMode('traverse'), '模式已切换：traverse');
  assert.strictEqual(api2.getMode(), 'traverse');
});

/* 场景 3：流程级测试（假定时器驱动 startNextFlow / handleCourseFinished） */
const ls3 = makeStore();
const ss3 = makeStore();
ls3.setItem('autoLearn.rule.example.com', JSON.stringify(RULE_JSON));
const C = loadScript({ localStorage: ls3, sessionStorage: ss3 });
const t3 = C.win.__autoLearn._t;
const api3 = C.win.__autoLearn;

/* 章节树 + 一个已播完的视频 + 返回按钮 */
const tree3 = new FakeEl('div', 'chapter-tree-player');
const mkItem3 = (num, name, extra = '') => {
  const item = new FakeEl('div', 'chapter-item level-2');
  const wrap = new FakeEl('div', 'item-wrapper' + extra);
  const numEl = new FakeEl('span', 'chapter-number');
  numEl.innerText = num;
  const nameEl = new FakeEl('span', 'chapter-name');
  nameEl.innerText = name;
  wrap.append(numEl, nameEl);
  item.append(wrap);
  return wrap;
};
const wA = mkItem3('1.1', '第一节', ' active');
const wB = mkItem3('1.2', '第二节');
tree3.append(wA.parentElement, wB.parentElement);
C.doc.body.append(tree3);
const video3 = new FakeVideo();
video3.currentTime = 306;
video3.ended = true;
video3.paused = true;
C.doc.body.append(video3);
C.doc.body.append(new FakeEl('button', 'back-btn'));

test('startNextFlow：播完 → 点下一章 → 新视频开播 → 流程结束', () => {
  t3.startNextFlow();
  const flowIdx = C.timers.length - 1;   // 最后注册的是流程定时器
  C.timers[flowIdx].f();                 // 第 1 轮：应点击 1.2
  assert.ok(String(t3.status()).includes('已点击下一章节'), '第 1 轮应点击下一章节，实际：' + t3.status());
  // 模拟平台响应：active 移到 1.2，视频换成新的（已开播）
  wA._class = wA._class.replace(' active', '');
  wB._class += ' active';
  video3.ended = false;
  video3.paused = false;
  video3.currentTime = 1;
  C.timers[flowIdx].f();                 // 第 2 轮：检测到新视频在播 → 完成
  assert.strictEqual(t3.status(), '已自动进入下一集');
});

test('handleCourseFinished（traverse 模式）：标记完成 + 点返回', () => {
  api3.setMode('traverse');
  const card = new FakeEl('div', 'course-card');
  const cn = new FakeEl('div', 'course-name');
  cn.innerText = '测试课程A';
  card.append(cn);
  C.doc.body.append(card);
  t3.enterCourse(card);
  t3.handleCourseFinished();
  const done = JSON.parse(ss3.getItem('autoLearn.done.example.com'));
  assert.ok(done.includes('测试课程A'), '完成记录应包含课程名，实际：' + JSON.stringify(done));
  assert.ok(String(t3.status()).includes('返回列表'), '应点击返回，实际：' + t3.status());
});

/* 场景 4：端到端遍历模拟（列表页→进课→播完→返回→下一门→全部完成） */
const ls4 = makeStore();
const ss4 = makeStore();
ls4.setItem('autoLearn.rule.example.com', JSON.stringify(RULE_JSON));
const D = loadScript({ localStorage: ls4, sessionStorage: ss4 });
const t4 = D.win.__autoLearn._t;
const api4 = D.win.__autoLearn;
api4.setMode('traverse');

const fireTick = () => D.timers[1].f();   // 0=fakeActivity, 1=tick
const fireFlow = () => { const i = D.timers.length - 1; D.timers[i].f(); };

/* 列表页：课程A、课程B、课程C(已完成) */
const makeListPage = () => {
  const list = new FakeEl('div', 'course-list');
  const mkCard = (name, doneText) => {
    const card = new FakeEl('div', 'course-card');
    const n = new FakeEl('div', 'course-name');
    n.innerText = name;
    card.append(n);
    if (doneText) {
      const b = new FakeEl('div', 'done-badge');
      b.innerText = doneText;
      card.append(b);
    }
    list.append(card);
    return card;
  };
  const cardA = mkCard('课程A');
  const cardB = mkCard('课程B');
  mkCard('课程C', '已完成');
  return { list, cardA, cardB };
};

/* 视频页：n 个章节 + 一个视频 + 返回按钮 */
const makeVideoPage = n => {
  const tree = new FakeEl('div', 'chapter-tree-player');
  let first = null;
  for (let i = 1; i <= n; i++) {
    const item = new FakeEl('div', 'chapter-item level-2');
    const wrap = new FakeEl('div', 'item-wrapper' + (i === 1 ? ' active' : ''));
    const numEl = new FakeEl('span', 'chapter-number');
    numEl.innerText = '1.' + i;
    const nameEl = new FakeEl('span', 'chapter-name');
    nameEl.innerText = '第' + i + '节';
    wrap.append(numEl, nameEl);
    item.append(wrap);
    tree.append(item);
    if (i === 1) first = wrap;
  }
  const video = new FakeVideo();
  video.ended = false;
  video.paused = false;
  video.currentTime = 5;
  const back = new FakeEl('button', 'back-btn');
  return { tree, video, back, first };
};

const setPage = els => D.doc.body.children.splice(0, D.doc.body.children.length, ...els);

const listPage = makeListPage();
let videoPage = null;
setPage([listPage.list]);

test('E2E-1：列表页自动进入课程A（跳过已完成课程）', () => {
  fireTick();
  assert.ok(String(t4.status()).includes('进入课程：「课程A」'), '实际：' + t4.status());
});

test('E2E-2：课程A 播完两节 → 标记完成 → 点返回', () => {
  videoPage = makeVideoPage(2);
  setPage([videoPage.tree, videoPage.video, videoPage.back]);
  // 第 1 节播完 → 自动点第 2 节
  videoPage.video.ended = true;
  videoPage.video.paused = true;
  videoPage.video.currentTime = 306;
  t4.startNextFlow();
  fireFlow();
  assert.ok(String(t4.status()).includes('已点击下一章节'), '实际：' + t4.status());
  // 第 2 节开播 → 流程确认切换成功
  videoPage.first._class = videoPage.first._class.replace(' active', '');
  videoPage.video.ended = false;
  videoPage.video.paused = false;
  videoPage.video.currentTime = 1;
  fireFlow();
  assert.strictEqual(t4.status(), '已自动进入下一集');
  // 第 2 节也播完 → 无下一章 → 课程完成 → 返回列表
  videoPage.video.ended = true;
  videoPage.video.paused = true;
  videoPage.video.currentTime = 306;
  t4.startNextFlow();
  for (let i = 0; i < 5; i++) fireFlow();   // 5 轮 → idle 满 5 → handleCourseFinished
  assert.ok(String(t4.status()).includes('返回列表'), '实际：' + t4.status());
  const done = JSON.parse(ss4.getItem('autoLearn.done.example.com'));
  assert.ok(done.includes('课程A'), '完成记录应包含课程A，实际：' + JSON.stringify(done));
});

test('E2E-3：回到列表 → 跳过课程A → 自动进入课程B', () => {
  setPage([listPage.list]);   // 模拟返回列表
  fireTick();
  assert.ok(String(t4.status()).includes('进入课程：「课程B」'), '实际：' + t4.status());
});

test('E2E-4：课程B 播完 → 返回 → 全部课程已完成 🎉', () => {
  videoPage = makeVideoPage(1);
  setPage([videoPage.tree, videoPage.video, videoPage.back]);
  videoPage.video.ended = true;
  videoPage.video.paused = true;
  videoPage.video.currentTime = 306;
  t4.startNextFlow();
  for (let i = 0; i < 5; i++) fireFlow();
  assert.ok(String(t4.status()).includes('返回列表'), '实际：' + t4.status());
  const done = JSON.parse(ss4.getItem('autoLearn.done.example.com'));
  assert.ok(done.includes('课程B'));
  setPage([listPage.list]);
  fireTick();
  assert.ok(String(t4.status()).includes('全部课程已完成'), '实际：' + t4.status());
});

/* 场景 5：tick 心跳（续播 / 续播失败 / 卡住检测）+ 向导生成规则回归 */
test('tick：暂停的视频被自动续播', () => {
  const E = loadScript();
  const t5 = E.win.__autoLearn._t;
  const v = new FakeVideo();
  v.currentTime = 10;
  v.ended = false;
  v.paused = true;
  E.doc.body.append(v);
  E.timers[1].f();                 // tick 1
  assert.strictEqual(v.paused, false, 'tick 应自动续播');
  assert.ok(String(t5.status()).includes('播放中'), '实际：' + t5.status());
});

test('tick：续播连续失败 → 自动触发切换流程', () => {
  const E = loadScript();
  const t5 = E.win.__autoLearn._t;
  const v = new FakeVideo();
  v.currentTime = 10;
  v.ended = false;
  v.paused = true;
  v.play = () => Promise.resolve();   // 续播无效
  E.doc.body.append(v);
  E.timers[1].f();
  E.timers[1].f();
  E.timers[1].f();                   // 第 3 次失败 → 触发 startNextFlow
  assert.ok(String(t5.status()).includes('无法续播'), '实际：' + t5.status());
  assert.strictEqual(E.timers.length, 3, '应注册了切换流程定时器（fakeActivity+tick+flow）');
});

test('tick：时间戳卡住 3 轮 → 自动触发切换流程', () => {
  const E = loadScript();
  const t5 = E.win.__autoLearn._t;
  const v = new FakeVideo();
  v.currentTime = 50;
  v.ended = false;
  v.paused = false;
  E.doc.body.append(v);
  for (let i = 0; i < 4; i++) E.timers[1].f();   // 第 4 轮卡住计数满 3 → 触发
  assert.ok(String(t5.status()).includes('卡住'), '实际：' + t5.status());
  assert.strictEqual(E.timers.length, 3);
});

test('wizard：只拾取课程项生成规则，保留内置返回按钮配置（回归）', () => {
  const E = loadScript();           // 内置示例规则（backSelector .back-btn）
  const t5 = E.win.__autoLearn._t;
  for (let i = 1; i <= 3; i++) {    // 3 门课，拾取中间那门
    const card = new FakeEl('div', 'course-card');
    const cn = new FakeEl('div', 'course-name');
    cn.innerText = '课程' + i;
    card.append(cn);
    E.doc.body.append(card);
  }
  const mid = E.doc.body.children[2].children[0];   // 课程2 的 .course-name
  t5.assignRole('courseItem', mid);                 // 拾取 → 应定位到 div.course-card
  t5.generateRule();
  const r = t5.getRule();
  assert.strictEqual(r.courseListPage.courseItemSelector, 'div.course-card');
  assert.strictEqual(r.courseListPage.backSelector, '.back-btn', '内置返回按钮配置应被保留');
  assert.strictEqual(r.videoPage.next.strategy, 'chapter-list', '章节策略应保留');
  assert.strictEqual(r.videoPage.next.listSelector, '.chapter-item .item-wrapper', '章节配置应保留');
  assert.strictEqual(r.videoPage.next.skipClass, 'no-video', '跳过项配置应保留');
  assert.ok(r.videoPage.dialogs[0].dismissTexts.includes('取消'), '弹窗配置应保留');
});

/* 场景 6：v1.6 全自动建档 + 草稿转正 + 失败回退 + 学习记录 */
test('auto-draft：陌生平台自动扫描生成草稿规则', () => {
  const F = loadScript({ hostname: 'school.example.edu' });
  const t6 = F.win.__autoLearn._t;
  const list = new FakeEl('div', 'lesson-list');
  for (let i = 1; i <= 3; i++) {
    const item = new FakeEl('div', 'lesson-item' + (i === 1 ? ' active' : ''));
    const n = new FakeEl('span', 'lesson-name');
    n.innerText = '第' + i + '节';
    item.append(n);
    list.append(item);
  }
  F.doc.body.append(list);
  assert.strictEqual(t6.maybeAutoDraft(), true);
  const r = t6.getRule();
  assert.strictEqual(r.draft, true, '应生成草稿规则');
  assert.strictEqual(r.videoPage.next.strategy, 'chapter-list');
  assert.strictEqual(r.videoPage.next.listSelector, 'div.lesson-item');
  assert.strictEqual(r.videoPage.next.activeClass, 'active');
});

test('草稿转正：切换流程成功 → draft 标记移除', () => {
  const F = loadScript({ hostname: 'school.example.edu' });
  const t6 = F.win.__autoLearn._t;
  const list = new FakeEl('div', 'lesson-list');
  for (let i = 1; i <= 3; i++) {
    const item = new FakeEl('div', 'lesson-item' + (i === 1 ? ' active' : ''));
    const n = new FakeEl('span', 'lesson-name');
    n.innerText = '第' + i + '节';
    item.append(n);
    list.append(item);
  }
  F.doc.body.append(list);
  t6.maybeAutoDraft();
  const video = new FakeVideo();
  video.currentTime = 306;
  video.ended = true;
  video.paused = true;
  F.doc.body.append(video);
  t6.startNextFlow();
  const flowIdx = F.timers.length - 1;
  F.timers[flowIdx].f();                 // 点下一章
  video.ended = false;
  video.paused = false;
  video.currentTime = 1;
  F.timers[flowIdx].f();                 // 新视频开播 → 成功
  assert.strictEqual(t6.status(), '已自动进入下一集');
  assert.strictEqual(t6.getRule().draft, false, '草稿应自动转正');
});

test('失败回退：草稿规则失败 → 回退通用模式并记录诊断', () => {
  const ls = makeStore();
  ls.setItem('autoLearn.rule.school.example.edu', JSON.stringify({
    name: '自动建档', draft: true,
    videoPage: {
      videoSelector: 'video',
      next: { strategy: 'chapter-list', listSelector: '.chapter-item .item-wrapper', activeClass: 'active', skipClass: '', nameSelector: '', texts: [], selector: '' },
      fallbackTexts: [],
      dialogs: [{ selector: '', dismissTexts: ['取消', '关闭'] }],
      completion: { stallSeconds: 24 }
    },
    courseListPage: null
  }));
  const F = loadScript({ hostname: 'school.example.edu', localStorage: ls });
  const t6 = F.win.__autoLearn._t;
  const video = new FakeVideo();
  video.currentTime = 306;
  video.ended = true;
  video.paused = true;
  F.doc.body.append(video);   // 无章节结构 → 草稿点不了下一项
  t6.startNextFlow();
  const flowIdx = F.timers.length - 1;
  for (let i = 0; i < 5; i++) F.timers[flowIdx].f();   // idle 满 5 → 回退
  assert.strictEqual(t6.getRule().name, '通用模式', '应回退通用模式');
  const stats = t6.loadStats();
  assert.ok(stats.log.some(e => e.type === 'fail'), '应记录失败诊断');
});

test('学习记录：完成视频入统计 + report() 日报', () => {
  const ls = makeStore();
  ls.setItem('autoLearn.rule.example.com', JSON.stringify(RULE_JSON));
  const F = loadScript({ localStorage: ls });
  const t6 = F.win.__autoLearn._t;
  const mkCh = (cls, name) => {
    const item = new FakeEl('div', 'chapter-item level-2');
    const wrap = new FakeEl('div', 'item-wrapper' + cls);
    const nameEl = new FakeEl('span', 'chapter-name');
    nameEl.innerText = name;
    wrap.append(nameEl);
    item.append(wrap);
    return wrap;
  };
  const w1 = mkCh(' active', '第一节');
  const w2 = mkCh('', '第二节');
  F.doc.body.append(w1.parentElement, w2.parentElement);
  const video = new FakeVideo();
  video.currentTime = 306;
  video.ended = true;
  video.paused = true;
  F.doc.body.append(video);
  t6.startNextFlow();
  const flowIdx = F.timers.length - 1;
  F.timers[flowIdx].f();
  video.ended = false;
  video.paused = false;
  video.currentTime = 1;
  F.timers[flowIdx].f();   // 成功 → recordStat('video', ...)
  const s = t6.loadStats();
  assert.strictEqual(s.videos, 1, '完成集数应计 1');
  assert.ok(s.seconds >= 306, '时长应计入（>=306 秒）');
  assert.ok(Object.keys(s.days).length >= 1, '应有今日记录');
  const rep = F.win.__autoLearn.report();
  assert.ok(String(rep).includes('今日：1 集'), '日报应显示今日完成');
});

/* 场景 7：v1.6.2 追踪日志 */
test('trace：logTrace 记录 + trace() 读取', () => {
  const F = loadScript();
  const t7 = F.win.__autoLearn._t;
  t7.logTrace('测试记录A');
  const api = F.win.__autoLearn;
  const t = api.trace();
  assert.ok(String(t).includes('测试记录A'), 'trace() 应能读到记录');
  assert.ok(String(t).includes('boot'), '启动时应有 boot 记录');
});

console.log('\n结果：' + passed + ' 通过，' + failed + ' 失败');
if (failed > 0) process.exit(1);
