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

On Windows, Codex ownership is checked by a non-mutating exclusive-open probe of
its existing writer lock. An inspection timeout/error is treated as occupied.
Remote process termination is unavailable on Windows; exit the CLI on the
computer, then continue in Panel. This avoids treating Windows SIGINT as a
portable graceful-exit mechanism.

## Validation and limits

- macOS: real interactive Claude Code 2.1.266 and Codex CLI 0.153.4 were started in
  an isolated test workspace, observed attached, and released with actual process
  exit before the server reported success. Codex was exercised through browser
  confirmation and status updates.
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
