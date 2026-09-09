# Known limitations — internal beta

Updated 2026-09-10. Passing CI is not evidence that every phone, CLI version or
native-session format is supported.

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
  and failure preserves the original. Real-phone accuracy acceptance is pending.
- Relay requests have a 10 MiB encoded-body limit; base64 adds overhead, so keep
  recordings and images below roughly 7 MiB per request. Long recordings should
  be split. Requests may be limited or time out; keep the computer awake and
  Connector terminal open.
- Physical iPhone Safari/Android Chrome microphone, images, background recovery,
  PWA reopen and full reconnect acceptance are not complete. Mobile viewport
  checks and synthetic audio do not replace those tests.
- Real interactive native handoff was verified on macOS with Codex 0.153.4 and
  Claude Code 2.1.266. Other CLI versions and real Windows/Linux CLI sessions
  still need acceptance. Windows terminal release requires manual exit. Shared
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
