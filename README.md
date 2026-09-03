# Learning Auto Player · 学习系统万能播放器

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-25%2F25-green)](#测试)

个人用的在线学习系统自动播放工具：自动续播、防暂停、自动签到、播完自动切下一集、自动跳过已完成课程、多门课自动遍历。两条使用路径（书签注入 / 本地真实浏览器播放器），按域名加载规则，内置录制向导，新平台无需改代码即可适配。

> A personal tool that auto-plays online-learning videos: anti-pause, auto-resume, auto-sign-in, auto-advance to the next lesson (skipping completed ones), and multi-course traversal. Two ready paths (bookmark injection / local real-browser player), domain-based rules with a built-in recording wizard — no code needed for new platforms.

> ⚠️ 仅供个人学习使用，使用前请确认符合所在公司/平台的使用规范。仓库内置规则仅为 `example.com` 示例，不含任何真实平台信息。
>
> ⚠️ 平台兼容性：书签/Tampermonkey 属于"页面注入"，部分平台（如网梯 whaty 系）会检测到注入并关闭页面，这类平台**请直接使用本地网址播放器**（`playwright/start.bat`，真实浏览器、零注入，已验证可靠）。

## 功能

- **防暂停**：让页面永远以为"标签页可见"，切走标签页/失焦不暂停（Tampermonkey 模式下完全免疫）
- **自动续播**：定时强制续播，被暂停也能拉回来；伪造鼠标/键盘活动防"操作超时"检测
- **自动签到**：网梯 whaty 等平台总览页的"立即签到"自动点击
- **自动切下一集**：播完自动关收尾弹窗 + 点下一集（支持章节列表 / 按钮文字 / CSS 选择器三种策略）
- **自动跳过已完成**：遍历时按平台"完成状态"判定，已学完的视频/课程自动跳过，只播未完成的
- **播完检测**：兼容不触发 `ended` 事件的播放器（时间戳卡住 / 续播失败判定）
- **多门课自动遍历**：进课 → 连播 → 无下一项 → 点返回 → 下一门 → 全部完成 🎉
- **录制向导**：新平台扫描 + 点选角色 + 自动生成选择器 + 试运行，免写代码
- **Playwright 兜底**：对付 `isTrusted` 校验 / 后端心跳 / 注入检测等硬骨头平台（真实浏览器 + 真实鼠标 + 零注入）
- **全自动建档**：陌生平台首次访问自动扫描并生成"草稿规则"，运行成功自动转正，失败自动回退通用模式并记录诊断（真正的"打开页面即用"）
- **学习记录**：自动统计完成集数 / 观看时长 / 完成课程 / 今日进度（本地存储，不上传），徽标显示今日进度，`report()` 出日报/周报，`diagnose()` 出诊断报告

## 快速开始

### 方式 A：网站书签（最普遍，推荐）

打开 **https://yyliucha.github.io/learning-auto-player/** → 把「▶ 单课连播」或「🚀 自动遍历」拖到书签栏（一次性）→ 打开学习平台页面 → 点书签，自动全流程运行。

原理：书签是 `javascript:` 小工具，**完整脚本已内嵌在书签地址里**（零外部加载，绕过目标平台 CSP），网站只是"脚本发放站"，一切运行都在用户浏览器内，账号与数据不上传任何服务器。

### 方式 B：本地网址播放器（硬平台首选，傻瓜式）

**双击 `playwright/start.bat` → 输入平台网址 → 真实浏览器打开 → 登录 → 全自动播放。**

- 真实 Chromium + 真实鼠标点击（`isTrusted=true`）+ 随机移动反检测，视频真实播放、进度真实上报
- 自动扫描建档（无需配置规则）：自动签到 → 自动进课 → 播完自动关弹窗 → 自动切下一集 → 已完成的自动跳过 → 课程播完自动返回 → 下一门 → 全部完成
- 书签一注入就被平台关页（网梯 whaty 系）时，用这条路径，已验证可靠
- 首次运行请在弹出的浏览器里手动登录，登录态与完成记录持久化在 `playwright/.auth/`（已 gitignore）
- 命令行等价方式：`node playwright/auto-learn.js --url <网址> [--rule <规则json>] [--limit 20]`
- 本机已安装 `playwright` 依赖与 Chromium，双击即用

### 方式 C：Tampermonkey（自动运行）

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 扩展
2. 新建脚本，粘贴 `auto-learn.user.js` 全部内容保存
3. 打开学习平台视频页，手动点第一个视频开始播放，之后即可切走

> 个别平台环境限制下 Tampermonkey 不会执行，可用方式 B 兜底。

### 控制台临时运行

打开学习页面 → F12 → Console → 粘贴 `auto-learn.user.js` 全部内容 → 回车（刷新页面后失效）。

### 三种模式（点击右下角徽标循环切换）

| 模式 | 行为 |
|---|---|
| ▶ 单课连播（默认） | 一门课内自动切下一集 |
| 🚀 自动遍历 | 一门课播完 → 返回列表 → 自动进下一门 |
| ⏸ 关闭 | 完全停手 |

> 💡 隐私提示：你自己的平台规则通过录制向导配置后，保存在浏览器 localStorage（`autoLearn.rule.<域名>`），只在本机生效，不会随代码上传。

## 配置新平台（录制向导）

1. 控制台输入 `__autoLearn.wizard()` 打开面板
2. 点一个角色按钮（如"⑥ 课程项"），再去页面上点对应元素（悬停有黄色高亮框）
3. 全部点完 → "生成规则并试运行" → 规则保存并立即生效（未拾取的字段保留现有配置）

完整规则格式、控制台命令说明见 [rules-format.md](rules-format.md)。

## 在线演示（GitHub Pages）

**https://yyliucha.github.io/learning-auto-player/demo/** —— 一个**模拟学习平台**的演示页，无需真实账号即可体验全部功能（模拟了"切标签页暂停"、"评价弹窗"、"无自动连播入口"三个真实平台特征）：

打开演示页 → 粘贴 `auto-learn.user.js` 到 F12 控制台（或 Tampermonkey 自动注入）→ 点【一键配置演示规则】→ 点击右下角徽标切到 **🚀 自动遍历** → 即可看到：自动进课 → 播完自动关弹窗 → 自动切下一章节 → 课程播完自动返回列表 → 进下一门 → 全部完成 🎉；播放中切走标签页视频不暂停。详见 [demo/README.md](demo/README.md)。

## 测试

```bash
node test/harness.js
```

零依赖 Node 冒烟测试（最小 DOM mock 加载完整脚本），25 项用例覆盖：规则解析、章节切换、遍历选课、向导拾取/生成、tick 心跳、流程级模拟、端到端遍历模拟。

## 目录结构

```
LICENSE                  MIT 许可证
auto-learn.user.js       油猴脚本（规则驱动引擎，全部功能入口，v1.7.2）
index.html               启动网站（书签生成器，GitHub Pages 部署）
rules-format.md          规则格式 + 命令参考
playwright/auto-learn.js 网址播放器（真实浏览器，输入网址即用，硬平台首选）
playwright/start.bat     傻瓜启动器（双击 → 输入网址）
test/harness.js          冒烟测试（node test/harness.js，25 用例）
demo/                    模拟学习平台演示页（GitHub Pages 在线版）
auto-learn.diag.user.js  诊断版油猴脚本（排查平台关页问题用，零修改）
auto-learn.selftest.user.js 自检脚本（判断 Tampermonkey 是否在平台页面执行）
```

## License

[MIT](LICENSE) © yyliucha
