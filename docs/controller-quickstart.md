# 电脑控制中心与手机遥控器

同一个 Connector 产品包含两种使用方式：

| 模式 | 启动 | 手机功能 |
| --- | --- | --- |
| Panel | `npm run connect` | 选择 Codex / Claude CLI、工作区，执行任务并查看回复 |
| 电脑控制中心 | `npm run connect -- --controller` | 给电脑绑定会话追加文字或语音，明确发送；完整草稿和回复留在电脑 |

两种模式使用独立端口与配对身份，可以同时运行。已有 Panel 配对不会自动授权新的控制中心。
同一控制中心内切换目标不需要手机重新配对，但必须在电脑重新绑定。

## 安装和启动

源码需要 Node.js 22.12+，推荐 Node.js 24。首次运行：

```bash
npm ci
npm run build
npm run connect -- --controller --check
npm run connect -- --controller
```

也可在已安装依赖后使用 `npm run controller`。检查只读安装信息，不启动 Agent 或请求辅助功能权限。
便携包使用自带 Node，无需安装 npm：

```bash
# macOS / Linux，在解压目录运行
bash "Vibe Panel.sh" --controller --check
bash "Vibe Panel.sh" --controller
```

Windows 在命令提示符运行 `"Vibe Panel.bat" --controller`。
默认端口 8897，终端显示实际电脑控制页和手机链接。退出终端或 Ctrl-C 停止服务。
端口冲突时设置 `PANEL_API_PORT`；启动器不会替换占用端口的其他服务。

## 选择电脑目标

- **Codex App / Claude App**：仅 macOS，需要目标应用、Apple 命令行工具和辅助功能权限。Claude App 目前支持 Code 中的现有会话。
- **Claude Code**：安装 CLI 并运行 `claude auth login`。默认在 Windows / Linux 选择此目标；在电脑控制页填写项目绝对路径并创建托管会话。
- 打开目标会话，点“绑定当前会话”。已有草稿保留。多个候选时，在高级设置选择目标再绑定。
- 绑定后不随前台焦点自动切换；切换目标会撤销旧绑定，不提交文字。
- Claude Code 输出与逐次工具授权只在电脑控制台展示。托管控制台不等于接管任意原生 TUI。

## 手机配对

使用终端二维码或电脑“连接手机”卡片中的首次连接入口。
链接采用 `/app?relay=<电脑标识>&next=controller`，直接进入遥控器；附带的配对码会预填，点击配对完成授权。
已有配对浏览器可直接打开该控制中心的手机地址。新码 10 分钟有效且只能使用一次。

默认使用 [Toolkit 产品入口](https://vibe.toolkit.fun) 与两个区域 Relay。
`PANEL_RELAY_URL` 可指定原有单节点或私有 Relay；`PANEL_RELAY_URLS` 与
`PANEL_RELAY_PUBLIC_URL` 配置多节点及产品入口，见 [区域 Relay](regional-relays.md)。
旧域名用户需显式设置 `PANEL_RELAY_URL=https://vibe.tooluse.app`，浏览器授权不跨域自动迁移。
当前配对和连接身份存于 `.vibe-panel/controller-devices.json` 与 `controller-relay.json`。
不要分享这些文件；移动旧安装时保留其私有状态，并使用原浏览器。

区域入口会选择可用节点并在状态读取失败时切换。草稿写入、发送、识别和配对不自动重放；
操作结果未知时先检查电脑再重试。旧 Relay 未更新固定跳转时会进入 Panel，需升级 Relay 后使用直接扫码流程。

## 语音、草稿与恢复

1. 手机点“开始录音”，说完再次点按识别；每段最长 60 秒。
2. 识别并纠错后追加到电脑草稿；继续录音可以追加下一段。
3. 在电脑核对完整草稿，再点手机“发送到电脑”。不会自动发送。
4. 识别失败时重试本页保留的最近一段音频，或打开文字补充手工修改。

切换目标、电脑改变草稿、断线或后台返回后的迟到识别结果需要重新核对。
锁屏或切后台会停止录音并释放麦克风。待处理文字保存在当前标签页，原始音频不持久化。
手机不展示完整电脑草稿或回复。支持八种布局、四种主题与 Micro 快捷指令；
快捷指令只追加草稿，尚未实现的原生 Fast、批准、拒绝、Fork、停止等操作会显示说明。

普通分段语音使用现有 Whisper 配置；见 [配置说明](configuration.md)。纠错跟随绑定目标的 provider，
失败保留识别原文。Codex 纠错当前需要 API key 配置，OAuth-only 与 App 内临时模型覆盖未接入。
实验增量识别默认关闭，需要单独设置 `PANEL_LIVE_SPEECH=1`，并指定装有
Whisper、numpy、torch、onnxruntime 和 silero-vad 的 `PANEL_LIVE_PYTHON`。
`--text-only` 关闭增量识别，不卸载或禁用已有普通分段识别。

托管 Claude Code 保存 session ID、工作目录、草稿及最近输出，默认保存于设备存储路径后加
`.managed.json` 的私有文件，可由 `PANEL_MANAGED_STATE` 覆盖。服务重启不启动 CLI、
不恢复旧授权、不重发任务，也不恢复手机绑定。结果未知时电脑须先确认恢复；旧进程仍活着时拒绝并发恢复。
原生 App 对话仍由原生应用保存。

## 支持范围

macOS App 控制依赖已验证的单窗口布局及辅助功能标识。应用升级、多窗口、锁屏或会话变化可能导致拒绝操作。
检查与系统事件之间存在竞态，发送时应保持目标会话稳定并核对电脑结果。
本次本地集成测试不能替代 Windows / Linux CI、手机麦克风与原生 App 真机验收。

开发时修改 `src/styles.css`、`public/controller-desktop.css` 和 `public/controller-mobile.css`；
`npm run build` 生成共享样式及 Relay 浏览器模块，不要手改生成文件。
