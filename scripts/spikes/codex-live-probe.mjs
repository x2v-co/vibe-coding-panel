// Connect ONLY to an existing daemon. No daemon start, resume, turn or UI mutation.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const binary = process.env.PANEL_CODEX_BIN || 'codex';
const args = ['app-server', 'proxy'];
if (process.env.PANEL_CODEX_SOCKET) args.push('--sock', process.env.PANEL_CODEX_SOCKET);
const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
const lines = createInterface({ input: child.stdout });
let finished = false;
function finish(result) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  console.log(JSON.stringify({ readOnly: true, ...result }, null, 2));
  lines.close();
  child.stdin.destroy();
  child.kill();
}
const timer = setTimeout(() => finish({ connected: false, reason: 'timeout' }), 8000);
child.on('error', error => finish({ connected: false, reason: error.code || 'spawn_failed' }));
child.stdin.on('error', () => {});
child.stderr.resume(); // Do not expose local configuration or conversation contents.
child.on('exit', code => finish({ connected: false, reason: 'proxy_exited', exitCode: code }));
function send(value) { child.stdin.write(`${JSON.stringify(value)}\n`); }
lines.on('line', line => {
  let message; try { message = JSON.parse(line); } catch { return; }
  if (message.id === 1) {
    if (message.error) return finish({ connected: false, reason: 'initialize_rejected', code: message.error.code });
    send({ method: 'initialized', params: {} });
    send({ id: 2, method: 'thread/loaded/list', params: {} });
  } else if (message.id === 2) {
    finish({ connected: true, loadedThreadCount: message.result?.data?.length ?? null,
      loadedListError: message.error?.code ?? null,
      desktopOwnershipVerified: false });
  }
});
send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'vibe_panel_readonly_probe', version: '0.1.0' } } });
