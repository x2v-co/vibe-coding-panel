# Native session handoff

The Panel reads saved Codex/Claude sessions for the selected canonical workspace.
Selecting a session does not start another writer. Resume checks ownership again
on the server and preserves the original session ID. A running Panel job or an
in-progress handoff reserves that session and rejects concurrent operations.

An attached terminal shows an explicit request and confirmation. Confirmation
can interrupt that terminal's current task. The UI then shows waiting for exit,
released, timeout or an actionable error. A signal being sent is not success:
the Connector reads ownership again before allowing continuation. It sends one
SIGINT to verified owners, never escalates to SIGKILL, and never deletes session
files or lock files. If the terminal does not exit, finish/stop it on the computer
and retry after the saved session becomes available.

Release validates both the session ID and workspace before looking up a process.
On macOS/Linux, Codex ownership is checked using lsof; the process must identify
as Codex and still own that specific lock immediately before the signal. Shared
app-server/remote-control daemons are never terminated for an individual session.
Claude release requires matching session/PID metadata and process name, plus the
recorded process start identity, to reject stale/reused PIDs. Older metadata or
unrecognized process wrappers require manual exit on the computer.
If a live Claude PID's metadata is incomplete or cannot be read, ownership is
unknown and continuation stays blocked until metadata is readable or that
process exits. The Connector does not remove the file or terminate an unverified
owner. Valid metadata for an unrelated session does not block continuation.

On Windows, Codex ownership is checked by a non-mutating exclusive-open probe of
its existing writer lock. An inspection timeout/error is treated as occupied.
Remote process termination is unavailable on Windows; exit the CLI on the
computer, then continue in Panel. This avoids treating Windows SIGINT as a
portable graceful-exit mechanism.

## Validation and limits

- The native picker explicitly includes Codex CLI, VS Code, exec and app-server
  sessions. Codex's default list filter excludes exec sessions; child-agent
  sources remain excluded.
- `node scripts/test-real-cli.mjs` runs official CLIs with temporary homes and a
  loopback model endpoint using a dummy API key. It checks actual session files,
  Panel discovery/read, workspace isolation, same-ID resume, restoration of both
  user and assistant context in the next provider request, and active/released
  ownership while the real CLI is awaiting its model response and after it exits.
  CI gates release on Codex 0.152.0 / 0.153.4 and Claude 2.1.265 / 2.1.266 on
  macOS ARM/Intel, Windows x64 and Linux x64. It does not test model quality,
  account authentication, or interactive-terminal process handoff in that matrix.

- Windows: the separate `windows-terminal` CI gate uses Windows Server 2025
  (10.0.26100), Node 24, Codex 0.153.4 and Claude Code 2.1.266 in real ConPTY
  terminals with isolated homes and a local model fixture. It checks interactive
  input and reply persistence, original context, occupied state, refusal of remote
  release, normal `/exit`, released state and subsequent same-ID continuation.
  No real account credentials are used. This does not verify a physical Windows
  11 desktop, phone-to-Windows UI or live provider authentication.

- Linux: the `linux-terminal` gate uses Ubuntu 24.04 with real PTYs, Codex
  0.153.4 and Claude Code 2.1.266 against the same isolated local model fixture.
  It checks interactive replies, ownership, verified remote release with observed
  terminal exit and subsequent same-ID continuation. Claude process identity uses
  Linux kernel start ticks; stale ticks and metadata from before process birth
  are rejected. This does not verify a physical Linux desktop or live accounts.

- macOS: real interactive Claude Code 2.1.266 and Codex CLI 0.153.4 were started in
  an isolated test workspace, observed attached, and released with actual process
  exit before the server reported success. Codex was exercised through browser
  confirmation and status updates.
- Android PWA: physical OPPO Find X9 Pro acceptance verified both agents' session
  discovery/read, occupied warning, computer-terminal exit and continuation with
  the original context. Connector records confirmed the original session IDs
  were retained. iPhone native handoff remains unverified.
- CI: workspace/ID isolation, already-released sessions, timeout/no-force-kill,
  unrelated live PID rejection, and live lock-handle detection are covered.
  Each supported OS runs its native lock probe. Fixture tests do not establish
  compatibility with every historical Codex/Claude release.
- Native session formats and process metadata belong to their respective CLIs.
  When an upgrade changes them, fail closed and use manual terminal exit rather
  than removing locks. Report the Connector and CLI versions in an issue.
- Phone microphone, background/reconnect and PWA behavior require separate real
  device acceptance; desktop browser tests do not establish those properties.

Feedback: https://github.com/x2v-co/vibe-coding-panel/issues
