# Learning Auto Player · 学习系统万能播放器

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-20%2F20-green)](#测试)

个人用的在线学习系统自动播放工具：自动续播、防暂停、播完自动切下一集、多门课自动遍历。按域名加载规则，内置录制向导，新平台无需改代码即可适配。

> A personal tool that auto-plays online-learning videos: anti-pause, auto-resume, auto-advance to the next lesson, and multi-course traversal. Domain-based rules with a built-in recording wizard — no code needed for new platforms.

> ⚠️ 仅供个人学习使用，使用前请确认符合所在公司/平台的使用规范。仓库内置规则仅为 `example.com` 示例，不含任何真实平台信息。

## 功能

- **防暂停**：让页面永远以为"标签页可见"，切走标签页/失焦不暂停（Tampermonkey 模式下完全免疫）
- **自动续播**：定时强制续播，被暂停也能拉回来；伪造鼠标/键盘活动防"操作超时"检测
- **自动切下一集**：播完自动关收尾弹窗 + 点下一集（支持章节列表 / 按钮文字 / CSS 选择器三种策略）
- **播完检测**：兼容不触发 `ended` 事件的播放器（时间戳卡住 / 续播失败判定）
- **多门课自动遍历**：进课 → 连播 → 无下一项 → 点返回 → 下一门 → 全部完成 🎉
- **录制向导**：新平台扫描 + 点选角色 + 自动生成选择器 + 试运行，免写代码
- **Playwright 兜底**：对付 `isTrusted` 校验 / 后端心跳等硬骨头平台（真实浏览器 + 真实鼠标）
- **全自动建档**：陌生平台首次访问自动扫描并生成"草稿规则"，运行成功自动转正，失败自动回退通用模式并记录诊断（真正的"打开页面即用"）
- **学习记录**：自动统计完成集数 / 观看时长 / 完成课程 / 今日进度（本地存储，不上传），徽标显示今日进度，`report()` 出日报/周报，`diagnose()` 出诊断报告

## 快速开始

### 方式 A：Tampermonkey（推荐）

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 扩展
2. 新建脚本，粘贴 `auto-learn.user.js` 全部内容保存
3. 打开学习平台视频页，手动点第一个视频开始播放，之后即可切走

### 方式 B：控制台临时运行

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

## 网址播放器（傻瓜式，真实平台适用）

**双击 `playwright/start.bat` → 输入平台网址 → 真实浏览器打开 → 登录 → 全自动播放。**

- 真实 Chromium + 真实鼠标点击（`isTrusted=true`）+ 随机移动反检测，视频真实播放、进度真实上报
- 自动扫描建档（无需配置规则）：自动进课 → 播完自动关弹窗 → 自动切下一集 → 课程播完自动返回 → 下一门 → 全部完成
- 首次运行请在弹出的浏览器里手动登录，登录态与完成记录持久化在 `playwright/.auth/`（已 gitignore）
- 命令行等价方式：`node playwright/auto-learn.js --url <网址> [--rule <规则json>] [--limit 20]`
- 本机已安装 `playwright` 依赖与 Chromium，双击即用

## 在线演示（本地）

仓库自带一个**模拟学习平台**的演示页，无需真实账号即可体验全部功能（模拟了"切标签页暂停"、"评价弹窗"、"无自动连播入口"三个真实平台特征）：

```bash
cd demo
python -m http.server 8000     # 或 npx http-server
```

打开 http://localhost:8000 ，然后：
1. 粘贴 `auto-learn.user.js` 到 F12 控制台（或 Tampermonkey 自动注入）
2. 点页面上的【一键配置演示规则】
3. 点击右下角徽标切到 **🚀 自动遍历**

即可看到：自动进课 → 播完自动关弹窗 → 自动切下一章节 → 课程播完自动返回列表 → 进下一门 → 全部完成 🎉；播放中切走标签页视频不暂停。详见 [demo/README.md](demo/README.md)。

## 测试

```bash
node test/harness.js
```

零依赖 Node 冒烟测试（最小 DOM mock 加载完整脚本），20 项用例覆盖：规则解析、章节切换、遍历选课、向导拾取/生成、tick 心跳、流程级模拟、端到端遍历模拟。

## Playwright 兜底工具

见上方"网址播放器"：`double-click playwright/start.bat` 或 `node playwright/auto-learn.js --url <网址>`。规则与油猴脚本共用同一格式（`--rule` 传 JSON 文件即可）。

## 目录结构

```
LICENSE                  MIT 许可证
auto-learn.user.js       油猴脚本（规则驱动引擎，全部功能入口）
rules-format.md          规则格式 + 命令参考
playwright/auto-learn.js 网址播放器（真实浏览器，输入网址即用）
playwright/start.bat     傻瓜启动器（双击 → 输入网址）
test/harness.js          冒烟测试（node test/harness.js）
demo/                    本地演示平台（模拟真实平台特征）
```

## License

[MIT](LICENSE) © yyliucha
