# Codex Micro controls

Reference: [official Codex Micro guide](https://learn.chatgpt.com/zh-Hans/docs/features/codex-micro), checked 2026-09-10.

The Panel implements a browser controller inspired by Micro. It does not connect
to the physical keyboard or control the ChatGPT desktop app.

| Control | Panel behavior |
| --- | --- |
| Default command keys | Fast, Approve, Decline, Fork, Mic, Send. Decline does not stop a job; Fork does not start an unrelated job. |
| Task lights | White: idle/read/stopped. Blue: queued/running. Green: completed with unread update. Red: failed. Off: unassigned. Selected task pulses. Amber is documented for awaiting input but not synthesized from running or stopped jobs. |
| Agent assignment | Recent updates (default), priority (unread then running), pinned, or six custom task slots. Empty custom slot assigns the next task created through it. |
| Command candidates | Available Panel actions and disabled desktop-only actions are grouped separately. Keycap icon changes swap existing icons without changing actions. Custom color is labeled keycap appearance, not task status. |
| Voice | Hold/release, double press within 350 ms for continuous recording. Teal while recording, pulsing white while processing, steady white for ready draft. Phone uses its own microphone. |
| Joystick | Default up: plan (unavailable), right: forward in Panel navigation, down: toggle sidebar, left: back. Drag past center threshold activates one direction per gesture; release/cancel recenters. Click arrows or keyboard arrows also work. All four directions can be remapped. |
| Dial | Default composer navigation highlights available input controls; press activates. Neighboring task key cancels selection; Esc closes a dialog opened from navigation. Drag vertically, wheel, or click left/right to turn. |
| Dial modes | Composer navigation, conversation scrolling (press jumps to newest content), custom left/right/press/hold actions. Reasoning-only is visible but unavailable. Hold opens settings except when a custom hold action is assigned. |
| Reset layout | Restores command keys and joystick defaults. Preserves Agent mode, task assignments and dial preferences. |

Unavailable desktop commands (native Fast/plan, approval, decline, context-preserving
fork, browser/terminal opening, review, Git/PR, plugins, schedules, reasoning and
skills) are never silently replaced with different operations. Default unsupported
keys explain the limitation; disabled picker entries cannot be selected as if
working. Saved custom mappings remain valid. Task switching remains disabled while
the currently selected job is running or voice/image processing is in progress.

Physical-device window focus, Bluetooth channels, USB layers, battery and hardware
brightness/auto-dim are not simulated as connected device features. Browser task
read markers and assignments persist on that browser; they do not synchronize
with ChatGPT desktop pins or desktop unread state.

Validation: state/migration/gesture unit tests; browser interaction checks for
configuration persistence, reset boundaries, task read state, joystick keyboard
and drag, dial navigation/cancel, custom actions and scrolling. Phone microphone,
OS keyboard and touch timing still require physical-device acceptance.
