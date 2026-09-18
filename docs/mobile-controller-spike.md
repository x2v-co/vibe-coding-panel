# 手机外设模式：桌面输入通路技术验证

日期：2026-09-11。分支：`spike/mobile-desktop-controller`。
本文保留最初的探针阶段记录，下面的“未验证”和“下一轮”不代表当前实现状态。
当前可用流程见 [开始使用](controller-quickstart.md)，后续验证与限制见 [原型说明](controller-prototype.md)。
范围：优先 Codex 桌面 App；后续 Codex CLI、Claude App、Claude Code。
本轮不修改产品运行路径，不涉及大陆 Relay 部署。

## 结论

已在 macOS 上通过辅助功能定位/写入和 CGEvent 系统点击，向 Codex App
现有测试会话发送固定回声请求，并从该会话记录核实精确响应。
没有退出 App，没有 resume 或启动替代会话运行时。

随后已验证后台发送：预先选定测试会话、composer 保持应用内焦点时，
AXValue 写入 + CGEvent Return `postToPid` 能发送到同一会话，且采样观测到
前台应用与鼠标位置均未变化。无需全局点击或激活 Codex。

限制：尚不能独立后台选择任意会话；定向鼠标没有完成切换。用户在 Codex 内
切到另一个会话时探针停止。实时语音和手机端到端尚未验证，不能发布为完整外设模式。

不能通过另起 `codex app-server` 并 `thread/resume` 来证明控制了桌面当前会话。
本机已有桌面进程，但默认 daemon control socket 不存在。

## 可复现探针

在仓库根目录运行；Swift 探针依赖 macOS/Xcode Command Line Tools。

```sh
swift scripts/spikes/desktop-accessibility.swift
PANEL_CODEX_BIN=/Applications/ChatGPT.app/Contents/Resources/codex node scripts/spikes/codex-live-probe.mjs
```

第一个命令只统计允许列表中应用的辅助功能控件，不输出会话文字、窗口标题或草稿。
第二个命令只尝试 `app-server proxy`，执行 initialize 和 thread/loaded/list；
不启动 daemon，不 resume，不发起 turn，不修改配置。可用 `PANEL_CODEX_SOCKET`
指定已知 socket；即使连接成功，也不能单凭 loaded list 证明它属于桌面 App。

可选、会修改界面状态的实验：

```sh
swift scripts/spikes/desktop-accessibility.swift --draft-roundtrip
swift scripts/spikes/desktop-accessibility.swift --draft-roundtrip --confirmed-empty-codex
swift scripts/spikes/desktop-accessibility.swift --enable-web-accessibility
```

`--draft-roundtrip` 仅在 Codex App 中找到唯一、值确认为空的可写文本控件时，
写入随机标记、立即读取、恢复空值并复查。不激活应用，不发送按键，不按 Send。
如果读回的值已被用户改变，不再覆盖。该探针仍不识别 session，应用界面变动或
进程在写入后崩溃可能影响恢复，仅用于专门的测试窗口，不能充当生产适配器。

本机空 composer 的 AXValue 是 `\nDo anything`，而非空字符串。之前将其误判为
12 字符草稿；在用户确认新测试会话后已查明。`--confirmed-empty-codex` 显式接受
该特定版本的表示，清空时写入空字符串，不能把提示文字写回当作真实草稿。

发送探针（会切换窗口、移动鼠标、发送固定无工具回声请求）：

```sh
swift scripts/spikes/codex-send-probe.swift --select-click '确认任务已就绪'
swift scripts/spikes/codex-send-probe.swift --send-click '确认任务已就绪'
```

`--select`/`--send` 是 AXPress 对照模式，不能凭返回 success 判断成功。
`--stream-draft-click` 尝试四次合成转写修订后清空，不是真实语音识别。
探针要求单应用窗口、唯一标题、空 composer；用本机版本侧栏 DOM class
辅助确认选中状态，发送前重查草稿。标题/class 不是可靠的生产 session ID，
仍有焦点竞争和检查到操作之间的竞态，不提供远程服务或任意文本执行接口。

后台实验：

```sh
swift scripts/spikes/codex-send-probe.swift --send-key-directed '确认任务已就绪'
swift scripts/spikes/codex-send-probe.swift --send-key-directed-preserve-draft '确认任务已就绪'
```

这两种模式不选择会话，不激活应用，也不投递全局鼠标/键盘事件。需要事先选择
专用测试会话，且输入框具有应用内焦点。第二种模式允许已有测试草稿，临时替换
为回声请求后恢复原草稿；目标/草稿被用户修改时不覆盖。发送可能重建 AX 节点，
恢复时重新查找 composer。崩溃仍可能阻止恢复；仅用于人工监督的测试会话。

`--select-directed` / `--send-directed` 使用定向鼠标，包括 PID 和窗口字段，
实测未完成会话切换，属于失败对照实验。不要把进程投递等同于目标已接收。

`--enable-web-accessibility` 尝试临时设置 AXManualAccessibility 并恢复原值。
本机返回 -25205（attributeUnsupported），没有证据表明该开关可用。

## 实测记录

| 项目 | 结果 | 含义 |
| --- | --- | --- |
| Codex bundle ID | com.openai.codex，位于 ChatGPT.app | 不能按 App 文件名猜测目标 |
| 系统辅助功能权限 | true | 当前探针执行身份可读取 AX 树；不代表将来分发的 Connector 自动有权限 |
| 浅层 AX 遍历 | 没有输入框 | 深度 24 不足，不能据此判定不支持 |
| 深度 60 AX 遍历 | 1 个 AXTextArea，1 个可写文本控件 | 找到潜在输入通路；仍需识别 composer 和绑定目标 |
| 草稿写入/恢复实验 | write/readback/restore 全部成功 | 该阶段证明 AX 接口读写；真实提交另行核实 |
| 纯 AXPress 选择/发送 | 接口 success，但目标无新消息，截图未切换 | 属于假阳性，不可作为送达证据 |
| CGEvent 选择 + AXValue 写入 + CGEvent Send | 成功 | 现有测试会话收到请求并返回标记 |
| 不存在的测试标题 | exit 1，未执行写入 | 未盲目操作当前会话 |
| 合成增量修订 | 未完成 | 首次因焦点/几何校验退出，再次因非空 composer 退出；未强行清空 |
| 后台定向鼠标 | 会话选择失败 | 未写入、未发送；没有自动退回抢焦点模式 |
| 后台定向 Return | 成功 | background=true、foregroundUnchanged=true、cursorUnchanged=true；会话记录确认响应 |
| 目标切走 | exit 1 | 停止写入，不追着用户切换焦点 |
| 现有 daemon proxy | exit 1 | 默认控制 socket 不存在 |
| daemon version | 同样报告 socket 不存在 | 不是手机网络或 Relay 故障 |
| Claude App | 本次未运行 | 未验证桌面控制能力 |
| 手机实时语音 | 未测试 | 不能宣称端到端打通 |

官方协议参考：https://developers.openai.com/codex/app-server/
本轮已读取官方页面及本机 app-server/proxy/daemon 帮助。
协议客户端能力不等同于任意运行中桌面 App 的控制入口。

## 下一轮验收

### 已核实的会话证据

- 测试会话：`确认任务已就绪`，ID `01a08e52-6e9c-7ba1-9dad-49783e869366`。
- 测试 turn：`01a08e5a-7198-7243-ab35-d3f9b6540596`，completed。
- 请求：固定中文回声任务，明确不调用工具、不修改文件。
- 响应：`VIBE_PANEL_OK_6C0718C6`，与发送探针随机标记完全一致。
- 发送由本地 Swift/系统事件完成；App 的 read_thread 工具仅用于独立验收，
  未使用 send_message_to_thread 代替产品控制通路。

后台 Return 验证：

- 同一测试会话，turn `01a08e74-e97a-7dd2-9f35-dd4485789f16`，completed。
- 精确响应：`VIBE_PANEL_OK_74963E10`。
- 发键前 Codex 非前台；发键后前台 PID 和鼠标坐标采样均不变。
- `navigate_to_codex_page` 仅用于实验前选好测试会话，不是独立 Connector 的实现能力。
- 首次恢复因旧 AX 节点失效而跳过；随后已重新定位，将测试前单字符草稿恢复并读回确认。
- 已修正探针的恢复逻辑；后续完整重测因目标已切走而拒绝执行。因此该自动恢复修正
  尚未完成端到端复测，不应标记为通过。

控件 AXIdentifier/AXDOMIdentifier 均为空；AXSelected 在已选中侧栏项上仍为 0。
因此稳定绑定仍未解决。现阶段可探索“用户手动选好会话、手机控制当前绑定输入框”
的模式，切换会话即失效；不能承诺任意后台会话控制。后续再验证合成增量草稿、
真实流式转写、稳定绑定和失焦情况下的拒绝行为。

先在 Codex App 专用测试会话中完成以下步骤，不从真实工作会话推断成功：

1. 识别 composer、窗口和目标会话；记录可稳定匹配的标识，验证切换会话后旧绑定失效。
2. 在空草稿中执行标记写入、读回、恢复；确认应用内部状态也接收变更。
3. 从手机触发草稿更新和显式发送，电脑同一会话显示输入和响应。
4. 切换窗口、电脑编辑草稿、断线重连和重复事件时，不向错误会话写入、不重复发送。
5. 流式音频送至电脑识别，partial 只更新草稿，final 保留为可发送内容；测试停止/取消。

建议命令包含 bindingId、bindingGeneration、eventId；语音更新包含 utteranceId
和递增 revision。目标切换使旧 generation 失效；重连不自动重放 Send。
这些是待验证的协议设计，不是已实现能力。

当前 Relay 将请求体完整缓冲后转发，手机 WebSocket upgrade 也没有通用通道。
实时音频需要新增传输设计，不能直接复用整段录音上传就声称实时。
先证明桌面控制，再做流式音频和手机控制面。

## 后续适配边界

- Codex/Claude CLI：优先 Connector 托管交互终端；独立运行中的终端附着另行验证。
- Claude App：独立验证 AX/快捷键能力，不复用 Codex 的控件定位假设。
- 本应用工具提供的线程操作：不能据此假设独立发布的 Connector 拥有相同接口。
- 完整 Micro 专属命令（审批、Fork、模式切换）逐应用检测能力，未验证时不可启用。
