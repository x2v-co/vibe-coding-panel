# 本地分支与主干产品整合

基准：2026-09-15 获取的 `origin/main`，提交 `8733c45`。
整合分支：`codex/vibepanel-product-integration`。

## 分支关系

| 本地目录 / 分支 | 与主干的关系 | 处理 |
| --- | --- | --- |
| `vibe-coding-panel` 独立克隆 | `7139b10`，落后当前主干 48 个提交 | 保留现场，不作为整合基准 |
| `test/vibe-coding-panel` / `main` | 获取远端后与 `origin/main` 一致 | 使用最新主干 |
| `spike/mobile-desktop-controller` | 提交与主干一致，但有 8 个已跟踪文件改动及 38 个未跟踪文件 | 在独立工作区迁入运行代码与测试，补齐产品交付 |
| `feat/toolkit-regional-relays` | 主干后新增 5 个提交，包含双区域传输、授权迁移与部署配置 | 全量整合，保留为分支历史 |
| `docs/clear-installation` | 历史功能分支，包含后来经主干重新提交的安装、同步与原生会话功能 | 按功能核对，不整体合并旧分支 |
| `codex/windows-interactive-acceptance` | 已通过主干 PR #4 收录功能 | 保留主干实现 |
| `codex/linux-interactive-acceptance` | 已通过主干 PR #5 收录功能 | 保留主干实现 |
| `codex/claude-ownership-race` | 已通过主干 PR #6 收录功能 | 保留主干实现 |

`git cherry` 中的不同补丁哈希并不意味着功能遗漏。主干的 `93cc6f7`、`739decd`、
`932199b`、`c740c32` 已分别包含安装与连接、跨浏览器任务同步、原生会话浏览和终端释放。
旧安装分支与主干直接比较会移除大量发布、权限与验收代码，因此不能用旧树覆盖当前主干。

## 完成的产品整合

- 源码和便携包共用 `--controller` 启动选项，Panel 保留原入口。
- macOS 默认使用 Codex App；Windows / Linux 默认使用 Claude Code。
- 控制中心采用独立持久配对身份，在电脑选择目标并绑定；切换目标撤销旧绑定。
- 普通分段语音默认启用已有语音配置，实验增量模式默认关闭。
- 控制器与 Panel 共用区域 Relay 配置、浏览器传输实现、八种布局与四种主题。
- 固定扫码目的地直接进入遥控器，保留电脑标识和配对码；配对仍需明确提交。
- 控制器状态可以跨节点重试，控制器写操作及录音识别不会自动重放。
- 便携包收录页面、浏览器模块、Swift 驱动、Python worker 和安装指南；Relay 镜像构建收录生成脚本。
- 机器专用部署记录和探针未纳入产品分发。原开发工作区内这些文件仍保留。

## 验证与交付边界

本地完成类型检查、生产构建、服务器及浏览器传输回归、安装验收、macOS ARM64
便携包生成与解压验证。解压测试使用隔离 fixture Agent，不代表真实模型服务已验收。
浏览器检查确认电脑页正常渲染、无控制台错误；390×844 区域入口能打开手机配对表单。

Linux 发布回滚脚本依赖 `flock`，当前 macOS 无法运行其测试；保留现有 Linux CI gate。
当前 Docker daemon 未启动，未本地构建容器镜像。Windows / Linux 真机、手机录音、
原生 App 绑定和发送仍需相应平台验收，既有现场验收不能自动视为此次整合通过。

改动交付于独立整合分支。原两个克隆和原型工作区未改写；尚未推送、合并远端主干或部署线上。
正式发布需要该分支通过原有四平台 CI 与真实 CLI gate，并按现有发布流程上线。

使用方法见 [控制中心指南](controller-quickstart.md)，发布流程见 [发布运维](release-operations.md)。
