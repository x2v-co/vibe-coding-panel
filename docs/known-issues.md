# Known limitations — internal beta

Updated 2026-09-10. Passing CI is not evidence that every phone, CLI version or
native-session format is supported.

## Physical-device acceptance — 2026-09-10

These results combine user-operated physical-device checks with Connector task
and session records. They cover the tested configurations, not every device.

| Configuration | Verified scope |
| --- | --- |
| OPPO Find X9 Pro, Android 16, PLG110 Build/BP2A.250605.015, Chrome 152.0.7977.75, installed PWA | Pairing; workspace roundtrip; Codex/Claude tasks; voice and editable drafts; images; stop and subsequent execution; background and network recovery; installation/reopen; existing-install update with pairing/history retained; both agents' native-session discovery, reading, occupied warning, actual Mac terminal exit and same-ID context continuation. |
| iPhone 15, user-reported iOS 26.6.1, Safari | Pairing; voice; keyboard editing and Codex submission; image answer accuracy; background recovery; network recovery with retained result; bottom controls visible above the Safari toolbar after the viewport fix. |
| Same iPhone, home-screen web app | Panel launch, connection, retained task history and microphone operation. |

Reported voice-to-draft latency was about 5–6 seconds on both phones with the
acceptance Mac's MLX turbo q4 backend and automatic correction enabled. This is
an observed result, not a performance guarantee for the portable CPU setup.
Device and browser versions above are user-reported.

## Current limitations

- Portable packages support macOS Apple Silicon/Intel, Windows x64 and Linux x64
  on compatible glibc distributions. They are unsigned ZIPs, not notarized apps
  or signed installers. Linux ARM and Alpine/musl packages are not provided.
- Node 24 and app dependencies are included. Install and authenticate Codex or
  Claude Code separately; their permissions, model providers and charges apply.
- Setup Voice installs CPU OpenAI Whisper and a multilingual small model. Allow
  about 3 GB of disk space and several minutes of internet downloads. Existing
  manual Whisper/MLX settings take priority. Setup does not install a correction
  provider or GPU drivers. Slow computers and long audio can exceed Relay timeouts.
- Mandarin homophone errors can remain after recognition and automatic correction.
  Corrected text is an editable draft, never an automatically executed command.
  Correction can call the configured Claude service before SEND, costs may apply,
  and failure preserves the original. Tested phone samples passed; this does not
  establish accuracy for every speaker, accent or recording environment.
- Relay requests have a 10 MiB encoded-body limit; base64 adds overhead, so keep
  recordings and images below roughly 7 MiB per request. Long recordings should
  be split. Requests may be limited or time out; keep the computer awake and
  Connector terminal open.
- iPhone acceptance was stopped at the tester's request. Remaining checks include
  stop/subsequent execution, Claude task execution, native-session handoff,
  workspace roundtrip, and voice-to-draft/image/background/network behavior in
  the installed iPhone web app. Android clean uninstall/reinstall was not tested
  separately from installation/reopen and existing-install updates. Mobile
  viewport checks and synthetic audio do not replace these physical tests.
- Real interactive native handoff was verified on macOS with Codex 0.153.4 and
  Claude Code 2.1.266, including Android PWA handoff. CI also verifies actual
  Codex 0.152.0/0.153.4 and Claude 2.1.265/2.1.266 executables against a local model
  fixture on all four supported OS/architecture runners. A separate Windows
  Server 2025 ConPTY gate verifies interactive handoff for Codex 0.153.4 and
  Claude 2.1.266 with a local model fixture. Physical Windows 11 desktop,
  phone-to-Windows UI, real Windows account authentication, interactive Linux
  terminal handoff and other CLI versions still need acceptance.
  Windows terminal release requires manual exit. Shared
  Codex daemon sessions cannot be terminated remotely; process identity or
  ownership uncertainty blocks handoff. See [handoff recovery](native-session-handoff.md).
- Browser history and project screenshots persist locally. Shared Relay traffic
  is not end-to-end encrypted; model services receive their requested inputs.
  See [privacy](https://vibe.tooluse.app/privacy/) and
  [terms](https://vibe.tooluse.app/terms/).

## Updates and feedback

For updates/rollback, stop the Connector and extract the desired version in a
new directory. Pairing state is separate from the application. See
[portable instructions](portable-connector.md).

Feedback: https://github.com/x2v-co/vibe-coding-panel/issues
Include the release revision, OS/architecture, relevant CLI version, steps and
expected/actual result. Remove credentials, pairing URLs, private code and audio
from public reports. Do not attach a complete local state directory.
