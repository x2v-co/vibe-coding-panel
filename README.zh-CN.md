# Vibe Coding Panel

[English](README.md) · [项目官网](https://vibe.tooluse.app/) · [体验面板](https://vibe.tooluse.app/app)

用手机控制电脑上的 Codex 或 Claude Code。说出需求、选择工作区、按下大按键，即可查看执行进度和结果，无需购买外设。

无需注册 Vibe Panel 账号、租服务器或安装 Tailscale。电脑上的 Connector 默认连接项目共享 Relay：`https://vibe.tooluse.app`，继续使用你现有的 Agent 登录和模型服务商配置。

## 让 Agent 帮你安装

将下面这段话发给**运行在自己电脑上的** Codex、Claude Code 或其他编程 Agent：

```text
请在这台电脑上安装并启动 Vibe Coding Panel。
仓库：https://github.com/x2v-co/vibe-coding-panel
读取下载目录中的 docs/install-for-agents.md，并按指南完成安装。
复用我现有的 Agent 登录、模型和 provider 配置，尽量安装本机 Whisper
语音输入；如果语音暂不可用，单独说明，不要影响文字功能。
确认 Connector 已在线后，展示手机配对二维码或链接，以及停止和再次启动的方法。
账号登录和手机麦克风授权由我完成；实际检查服务后再报告安装成功。
```

[Agent 安装指南](docs/install-for-agents.md)包含系统检测、安装命令、已有目录处理、验证及交付要求。

## 下载便携运行包

[下载 Connector](https://vibe.tooluse.app/download)：提供 macOS Apple Silicon／Intel、Windows x64 和 Linux x64 版本。内含 Node.js 24 和锁定依赖，完整解压后运行对应启动文件，无需另装 Node 或 npm。仍需安装并登录 Codex／Claude；语音所需 Whisper／ffmpeg 可选安装。当前为未签名的内测包。[运行包说明与限制](docs/portable-connector.md) · [版本与校验文件](https://github.com/x2v-co/vibe-coding-panel/releases/latest)。

## 从源码安装：三步开始

**准备好：**macOS、Windows 10/11 或 Linux 电脑，安装 [Node.js 24 LTS](https://nodejs.org/zh-cn/download)。安装并登录 [Codex CLI](https://developers.openai.com/codex/cli/) 或 [Claude Code](https://code.claude.com/docs/zh-CN/setup)，先在其终端发送一句话，确认能正常回复。

1. **下载并解压**[项目 ZIP](https://github.com/x2v-co/vibe-coding-panel/archive/refs/heads/main.zip)。打开解压后的文件夹，不要直接在压缩包里运行。
2. **在电脑上启动**下表对应文件。第一次启动会自动安装 Node 依赖。
3. **手机扫描终端二维码**，用 Safari、Chrome 或 Edge 打开。选择 Agent 和工作区，先发一条文字指令。

| 电脑系统 | 启动方式 |
| --- | --- |
| macOS | 双击 `Vibe Panel.command` |
| Windows | 双击 `Vibe Panel.bat` |
| Linux | 在解压目录运行 `npm install`，再运行 `npm run connect` |

使用期间保持终端打开、电脑唤醒。手机和电脑不必在同一网络。配对码 10 分钟内有效且只能使用一次；已配对的浏览器通常无需重复扫码。

习惯终端操作？安装 Git 后执行：

```bash
git clone https://github.com/x2v-co/vibe-coding-panel.git
cd vibe-coding-panel
npm install
npm run connect
```

下载目录没有启动文件，或出现 `Missing script: "connect"`，说明拿到的是旧包。请看[常见问题](#常见问题)，不要自行补一个空脚本。

## 开启语音输入

文字功能不需要 Python。语音功能需要 [Python 3.12](https://www.python.org/downloads/)，安装后在**项目目录中**执行一次：

macOS / Linux：

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -U openai-whisper imageio-ffmpeg
```

Windows PowerShell：

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U openai-whisper imageio-ffmpeg
```

重新启动 Connector。无需激活虚拟环境，启动器会自动检测；日志应同时显示 `Whisper:` 和 `ffmpeg:` 路径。不需要另装系统 ffmpeg。Linux 如提示缺少 venv，安装对应发行版的 Python venv 软件包后重试。

第一次转写会下载约 461 MB 的 Whisper `small` 模型，请耐心等待。手机允许当前网站使用麦克风后，点击 **VOICE INPUT** 开始，说完再点一下结束。识别文字先填入草稿，按 **SEND** 才会执行。浏览器录音失败时，可选择上传系统录音文件。

## 选择 Agent

手机面板中可选择 Codex 或 Claude Code。如需双击启动时记住默认选择，在项目内创建 `.vibe-panel/connector.json`：

```json
{"agentProvider":"claude"}
```

改为 `codex` 即可切回。该文件不会提交到 Git；如果设置了 `PANEL_AGENT_PROVIDER` 环境变量，以环境变量为准。Panel 复用 CLI 的凭据和 provider，CLI 自身的授权错误需要先在 CLI 中解决。

## 运行截图

<p align="center">
  <img src="docs/screenshots/runtime/panel-desktop.png" alt="Vibe Panel 桌面运行截图：Micro 布局" width="72%" />
  <img src="docs/screenshots/runtime/panel-mobile.png" alt="Vibe Panel 手机运行截图" width="24%" />
</p>

## 功能与边界

### 接续终端里的原生会话

选择与终端一致的 **Workspace** 和 **Agent**，打开 **任务记录 → 原生会话**，选择对话。页面每 3 秒读取已保存的新消息。Workspace 按实际目录精确匹配，父目录不会包含所有子项目。

发送追问前，先退出终端里的该会话，在 Panel 勾选交接确认、输入指令，点击 **发送并接续原会话**。CLI 使用原 session ID 和已有配置继续执行。回到终端时，等 Panel 执行结束，在对应目录运行页面显示的 `codex resume <id>` 或 `claude --resume <id>`。

这是原生历史同步和会话交接，不是镜像或控制已经打开的终端。检测到会话占用时会阻止接续；不同 CLI 版本、操作系统可用的进程信息不同，所以仍需确认退出原会话，避免两端同时写入。Codex 需要支持 `app-server` 的 `thread/list`、`thread/read`；Claude 读取本地项目记录，支持 `CLAUDE_CONFIG_DIR`。Relay 和本机/直连使用电脑 Connector，旧版 Remote Bridge 模式暂仅展示 Panel 任务。更新后请重启 Connector。

- 大按键、手机专注模式、文字与语音输入、图片上传、工作区目录选择。
- Codex 与 Claude Code 实时输出、停止、追问和浏览器历史记录。
- 八种键位布局、四种配色；Micro 支持自定义动作、文案、颜色和 SVG 键帽。
- Micro 语音键：按住说话，松开转写；350 ms 内双击锁定录音，再按一次结束。
- 演示模式和可添加到主屏幕的 HTTPS PWA；演示不会执行真实任务。
- 一次性配对，可在电脑的本地设置中撤销设备授权。

当前 CLI 适配器尚未实现 Micro 原生 Fast mode、批准/拒绝、会话分叉和计划模式，对应按键会说明限制。屏幕捕获取决于桌面浏览器支持，手机使用图片上传。浏览器历史不保证在 Connector 重启后恢复原会话。

## 常见问题

| 问题 | 怎么处理 |
| --- | --- |
| macOS 双击打不开 | 在解压目录打开终端，执行 `bash "Vibe Panel.command"`。 |
| 找不到 `node` / `npm` | 安装 Node.js 24 LTS，关闭终端后重新打开再启动。 |
| `Missing script: "connect"` | 确认当前目录的 `package.json` 有 `connect` 脚本。重新获取当前 Connector 安装包；如果公开包仍缺少脚本，反馈打包问题。 |
| 未检测到可用 Agent / 授权失败 | 直接运行 `codex` 或 `claude`，确认一条真实文字请求可用，Panel 会复用该配置。 |
| 手机提示电脑离线 | 保持 Connector 运行、电脑唤醒，等终端显示“电脑 Connector 已连接”，再扫码。 |
| 配对码过期 | 重启 Connector 获取新码，已配对的浏览器通常无需重配。 |
| Whisper 或 ffmpeg 未检测到 | 完成上面的语音安装后重启，无需激活 Python 虚拟环境。 |
| 更新后语音仍是旧行为 | 先结束正在运行的任务，再重启电脑 Connector，并刷新手机页面。 |

## 隐私

Agent 和 Whisper 都在自己的电脑上运行。默认共享 Relay 会在内存中转发指令、录音、图片与结果，Relay 实现不持久保存这些内容。这**不是端到端加密**，请使用可信的 Relay，也可[自建服务](docs/relay-deployment.md)。Agent 仍会把其工作所需的数据发送给你配置的模型服务商。

浏览器保存偏好和演示历史；Panel 任务通过电脑 Connector 内存共享。原生记录保存在 CLI 的本地目录，打开会话时可见消息会经过所选连接传输。电脑保存设备授权哈希，手机通过配对 Cookie 获得授权。可在电脑本地设置中撤销陌生设备。详见 [SECURITY.md](SECURITY.md)。

## 高级使用与开发

纯本机使用、Tailscale/Bridge 和环境变量见[配置说明](docs/configuration.md)；服务维护者可参考 [Relay 部署指南](docs/relay-deployment.md)。普通用户直接使用共享 Relay 即可。

```bash
npm run dev
npm test
npm run check
npm run build
```

开发时打开终端打印的 Vite 地址，通常为 `http://localhost:5178`。开发服务与手机 Connector 启动流程是两回事。

[参与贡献](CONTRIBUTING.md) · [更新记录](CHANGELOG.md) · [产品与发布背景](docs/brand-led-release-route.md) · [MIT 许可证](LICENSE)

本项目与 OpenAI、Codex、Anthropic、Claude Code 没有隶属或背书关系。

## Release readiness

See [startup diagnostics, cross-platform acceptance, Relay limits and release/rollback operations](docs/release-operations.md).
