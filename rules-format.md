# 学习系统万能播放器 —— 规则格式参考（v1.6）

配套脚本：`auto-learn.user.js`（规则驱动版）

## 全自动建档（v1.6，零配置新平台）

陌生平台**首次访问自动扫描**页面（≥3 个同结构子元素的列表候选、按类名区分课程/章节），生成**草稿规则**（徽标显示 `[自动建档·草稿]`），无需任何手动配置：

- 运行成功（自动切到下一集）→ 草稿自动**转正**（去掉 draft 标记）
- 运行失败（找不到下一项/超时）→ 自动**回退通用模式** + 记录诊断到学习记录
- 想手动修正：`__autoLearn.wizard()` 打开向导，或 `__autoLearn.diagnose()` 看诊断报告
- 有稳定规则/内置规则的域名不会被打扰

## 学习记录（v1.6，本地统计）

本地 localStorage 自动记录：完成视频数、观看时长、完成课程数、今日进度、操作日志（含失败诊断）。徽标显示"今日 X 集·Y 分"。

- `__autoLearn.report()` 输出日报/周报（今日/近 7 天/最近活动）
- `__autoLearn.diagnose()` 输出诊断报告（当前规则、失败记录、页面扫描、视频状态）
- `__autoLearn.clearStats()` 清空本域学习记录

## 三种模式（点击右下角徽标循环切换，状态存 localStorage）

| 模式 | 徽标 | 行为 |
|---|---|---|
| 单课连播（默认） | ▶ | 一门课内自动切下一集 |
| 自动遍历 | 🚀 | 一门课播完 → 点返回 → 自动进下一门课 |
| 关闭 | ⏸ | 完全停手 |

也可以用控制台切换：`__autoLearn.setMode('traverse')`。

## 录制向导（配置新平台，免写代码）

控制台输入 `__autoLearn.wizard()` 打开面板：

1. 点一个**角色按钮**（如"② 章节项"）
2. 去页面上**点对应的元素**（鼠标悬停有黄色高亮框）
3. 全部点完 → 点 **"生成规则并试运行"**
4. 规则自动保存到 localStorage 并立即生效，试运行结果显示在面板和控制台

角色说明：

| 角色 | 点哪个元素 | 生成到规则里 |
|---|---|---|
| ① 视频元素 | 视频画面 | `videoSelector` |
| ② 章节项 | 当前播放中的章节（列表里任意一项） | `next.listSelector` + 自动识别 `activeClass`/`skipClass` |
| ③ 下一集按钮（可选） | "下一集"按钮 | `next.texts` 或 `next.selector` |
| ④ 关弹窗按钮 | "取消"/"关闭"按钮 | `dialogs[].dismissTexts/selector` |
| ⑤ 返回列表按钮 | 视频页的返回按钮 | `backTexts` 或 `backSelector` |
| ⑥ 课程项 | 课程列表页的任意一门课 | `courseListPage.courseItemSelector` |
| ⑦ 进入课程按钮（可选） | 课程卡片上的"开始学习" | `enterTexts` |
| ⑧ 完成标记（可选） | 已完成课程的标记图标 | `doneSelector` |

向导会自动生成 CSS 选择器（优先 id/class，过滤 `active`/`vjs-`/`el-` 等易变类）；章节项会自动识别"当前项标记 class"和"跳过项 class"（如示例规则的 `active`/`no-video`）。

**拾取小技巧（v1.3）**：点"章节项/课程项"时点行内任意文字都行，向导会自动向上定位到行容器（v1.5 起优先选"有子元素"的容器，避免误选行内标题）；点按钮类角色时点图标/文字都行，会自动定位到按钮元素；点"视频元素"时点播放器任意区域都行，会自动定位到 `<video>`。若 active 标记识别失败，面板会显示"⚠未识别"。

**生成规则（v1.5）**：向导只覆盖"拾取过的"字段，未拾取的部分保留现有规则（内置/已保存），不会误清掉返回按钮、章节策略等既有配置。

## 规则对象

每个域名一份规则，存 localStorage（键名 `autoLearn.rule.<域名>`）。内置规则无需配置，自定义规则可 `saveRule` 或向导生成。

```json
{
  "name": "某学习平台",
  "videoPage": {
    "videoSelector": "video",
    "next": {
      "strategy": "chapter-list",
      "listSelector": ".chapter-item .item-wrapper",
      "activeClass": "active",
      "skipClass": "no-video",
      "nameSelector": ".chapter-name",
      "texts": [],
      "selector": ""
    },
    "fallbackTexts": ["下一课", "下一节"],
    "dialogs": [{ "selector": "", "dismissTexts": ["取消", "关闭"] }],
    "completion": { "stallSeconds": 24 }
  },
  "courseListPage": {
    "courseItemSelector": ".course-card",
    "nameSelector": ".course-name",
    "enterTexts": ["开始学习", "继续学习"],
    "doneSelector": "",
    "doneTexts": ["已完成"],
    "backSelector": ".back-btn",
    "backTexts": ["返回", "返回列表"],
    "maxCoursesPerSession": 20
  }
}
```

### videoPage 字段

| 字段 | 说明 |
|---|---|
| `videoSelector` | 视频元素 CSS 选择器，默认 `video` |
| `next.strategy` | 找"下一集"策略：`chapter-list`（章节列表）或 `button`（按钮） |
| `next.listSelector` | chapter-list 策略：章节项选择器 |
| `next.activeClass` | 当前章节的标记 class |
| `next.skipClass` | 要跳过的项（如分组标题） |
| `next.nameSelector` | 章节名子元素选择器（日志用） |
| `next.texts` | button 策略：匹配按钮文字（包含即匹配） |
| `next.selector` | button 策略：按钮 CSS 选择器（图标按钮无文字时用） |
| `fallbackTexts` | 章节列表找不到时的兜底按钮文字 |
| `dialogs[].selector` | 弹窗关闭按钮选择器（图标按钮用） |
| `dialogs[].dismissTexts` | 弹窗关闭按钮文字 |
| `completion.stallSeconds` | 时间戳卡住多久算"播完"，默认 24 |

切下一集的查找优先级：章节列表 → `next.selector` → `next.texts` → `fallbackTexts` → 都没有则判定"课程播完"。

### courseListPage 字段（自动遍历用，没有就填 null）

| 字段 | 说明 |
|---|---|
| `courseItemSelector` | 课程项选择器（遍历的入口，空字符串=禁用遍历） |
| `nameSelector` | 课程名子元素（用于完成记录去重） |
| `enterTexts` | 课程项上的入口按钮文字（如"开始学习"）；没有就点课程项本身 |
| `doneSelector` | "已完成"标记元素选择器（可选） |
| `doneTexts` | 课程项文字里出现即视为完成 |
| `backSelector` | 视频页返回按钮选择器（图标按钮必须用这个） |
| `backTexts` | 返回按钮文字兜底 |
| `maxCoursesPerSession` | 一轮最多进出几门课（防死循环），默认 20 |

### 遍历状态机

```
列表页（无 video）→ 找第一门未完成课程 → 点击进入
  → 视频页：章节连播 → 无下一项 → 标记课程完成 → 点返回按钮
  → 回到列表页 → 下一门未完成课程 → 循环
  → 全部完成 → 徽标显示"全部课程已完成 🎉"
```

- "已完成课程"记录存 sessionStorage（`autoLearn.done.<域名>`），刷新不丢、关浏览器后清零
- 进入课程 60 秒后还没出现视频 → 自动清空状态重试
- 到达 `maxCoursesPerSession` 上限自动停止

## 内置规则

| 域名 | 平台 | 视频页策略 | 课程遍历 |
|---|---|---|---|
| `example.com` | 示例学习平台 | 章节列表（`.chapter-item .item-wrapper`） | 返回按钮已配（`.back-btn`），课程项待配置 |

## 通用模式

没有配置的域名自动用"通用模式"：`video` 选择器 + 常见文字按钮 + 取消/关闭弹窗，课程遍历禁用。

## 控制台命令

```js
__autoLearn.help()                        // 命令列表
__autoLearn.getRule()                     // 查看当前规则
__autoLearn.saveRule({ name, videoPage, courseListPage })  // 保存规则（立即生效）
__autoLearn.clearRule()                   // 删除自定义规则（回退内置/通用）
__autoLearn.exportRules()                 // 导出本域名规则 JSON 文本
__autoLearn.importRules('{...}')          // 导入规则
__autoLearn.setMode('single|traverse|off') // 切换模式
__autoLearn.scan()                        // 扫描页面结构（辅助写规则）
__autoLearn.wizard()                      // 打开/关闭录制向导
__autoLearn.report()                      // 学习记录日报/周报
__autoLearn.diagnose()                    // 诊断报告（排查用）
__autoLearn.clearDone()                   // 清空完成记录（重新遍历用）
__autoLearn.clearStats()                  // 清空本域学习记录
```

注意：localStorage 是按域名隔离的，`exportRules()` 只能导出当前域名下的规则。

## 调试接口

`__autoLearn._t` 暴露内部函数，排查问题时可用：
`findVideo()` / `findNextChapter()` / `findNextCourse()` / `isCourseDone(el)` / `getRule()` / `tick()` 等。

## 测试

`test/harness.js`：零依赖 Node 冒烟测试（最小 DOM mock 加载脚本，覆盖规则解析、章节切换、遍历选课、向导拾取、tick 心跳（续播/续播失败/卡住检测）、startNextFlow/handleCourseFinished 流程级模拟、向导规则生成回归、以及"列表页→进课→播完→返回→下一门→全部完成"的端到端遍历模拟，共 20 项）。运行：`node test/harness.js`。

## Phase 4：Playwright 兜底工具

`playwright/auto-learn.js` —— 对付油猴脚本搞不定的平台（isTrusted 校验、后端心跳、复杂流程）。

原理：真实 Chromium + **真实鼠标点击**（`isTrusted=true`）+ 随机移动反检测 + 视频真实播放（进度真实上报），行为上几乎无法与真人区分。规则格式与油猴脚本完全共用（`--rule` 传 JSON 文件）。

```bash
npm install playwright
npx playwright install chromium
node playwright/auto-learn.js --domain example.com [--rule rules/xx.json] [--limit 20]
```

- 首次运行：在弹出的浏览器里手动登录，登录完自动继续；登录态存 `.auth/<域名>.json`
- 完成记录存 `.auth/<域名>.done.json`，下次运行自动跳过已完成的课
- `--headless` 仅调试用；正式跑建议默认有头模式

## 路线图

- [x] Phase 1：规则化引擎 + 示例内置规则（v1.0）
- [x] Phase 2：课程遍历状态机（v1.1）
- [x] Phase 3：录制向导（v1.2 核心 + v1.3 智能拾取）
- [x] Phase 4：Playwright 兜底工具就绪（v1.4，随时可用）
- [x] Phase 5：全自动建档 + 失败回退/诊断 + 学习记录（v1.6）
- [ ] 实测收尾：在真实平台用向导配置课程项 + 验证遍历
