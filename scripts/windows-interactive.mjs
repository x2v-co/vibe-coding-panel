// Real Windows ConPTY acceptance. Only created test terminals are controlled.
import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

export async function checkWindowsTerminal({ provider, bin, id, workspace, env, sessions, requests }) {
  assert.equal(process.platform, 'win32');
  const { spawn } = await import('node-pty');
  const args = provider === 'codex'
    ? ['resume', '--no-alt-screen', id]
    : ['--resume', id, '--setting-sources', '', '--tools', '', '--model', 'claude-sonnet-4-6'];
  const quote = text => `'${text.replaceAll("'", "''")}'`;
  const command = `& ${[bin, ...args].map(quote).join(' ')}; exit $LASTEXITCODE`;
  const terminal = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', command], {
    cwd: workspace, env: { ...env, TERM: 'xterm-256color' }, cols: 120, rows: 36,
    useConpty: true,
  });
  let output = '', exited = false, exitCode, trusted = false, trustTimer;
  const type = text => {
    // ConPTY enables Win32-input mode; plain CR is not a key event in this mode.
    const win32 = output.lastIndexOf('\x1b[?9001h') > output.lastIndexOf('\x1b[?9001l');
    if (!win32) { terminal.write(text); return; }
    for (const char of text) {
      const unicode = char.codePointAt(0);
      const vk = char === '\r' ? 13 : /[a-z0-9 ]/i.test(char) ? char.toUpperCase().charCodeAt(0) : 0;
      const scan = char === '\r' ? 28 : 0;
      terminal.write(`\x1b[${vk};${scan};${unicode};1;0;1_\x1b[${vk};${scan};${unicode};0;0;1_`);
    }
  };
  terminal.onData(chunk => {
    output = (output + chunk).slice(-40000);
    // Codex queries cursor position during terminal initialization.
    if (chunk.includes('\x1b[6n')) terminal.write('\x1b[1;1R');
    if (!trusted && provider === 'codex' && stripVTControlCharacters(output).includes('Press enter to continue and create a sandbox')) {
      trusted = true;
      // Wait for the TUI to finish switching console input modes after painting.
      trustTimer = setTimeout(() => {
        console.log(`${provider}: confirming isolated workspace trust`);
        type('\r');
      }, 1500);
    }
  });
  terminal.onExit(event => { exited = true; exitCode = event.exitCode; });
  const waitFor = async (description, condition, timeout = 45000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await condition()) return;
      if (exited) throw new Error(`${provider} terminal exited ${exitCode} while ${description}`);
      await delay(400);
    }
    throw new Error(`${provider}: timeout ${description}`);
  };
  try {
    await waitFor('waiting for occupied session', async () => !(await sessions.read(provider, workspace, id)).canResume);
    const occupied = await sessions.read(provider, workspace, id);
    assert.equal(occupied.status, 'attached');
    assert.equal(occupied.canRelease, false, 'Windows must direct users to exit the terminal');
    await assert.rejects(sessions.release(provider, workspace, id), /Ctrl\+C|退出 CLI/);
    assert.equal(exited, false, 'unsupported remote release must leave the terminal running');
    assert.equal((await sessions.read(provider, workspace, id)).canResume, false);
    const before = requests.length;
    type('INTERACTIVE_TURN_MARKER. Recall the earlier marker.\r');
    await waitFor('waiting for interactive model request', () => requests.slice(before).some(r =>
      r.provider === provider && JSON.stringify(r.input).includes('INTERACTIVE_TURN_MARKER')));
    const sent = requests.slice(before).filter(r => r.provider === provider);
    assert(sent.some(r => JSON.stringify(r.input).includes('FIRST_TURN_MARKER')));
    await waitFor('waiting for saved interactive reply', async () => {
      const messages = (await sessions.read(provider, workspace, id)).messages;
      const marker = messages.findIndex(m => m.role === 'user' && m.text.includes('INTERACTIVE_TURN_MARKER'));
      return marker >= 0 && messages.slice(marker + 1).some(m => m.role === 'assistant' && m.text.includes('COMPATIBILITY_READY'));
    });
    // Simulates the supported user action: type /exit in this owned terminal.
    type('/exit\r');
    await waitFor('waiting for terminal exit', () => exited);
    assert.equal(exitCode, 0);
    assert.equal((await sessions.read(provider, workspace, id)).canResume, true);
    console.log(`${provider}: Windows ConPTY interactive prompt, occupied/release refusal, terminal /exit and released state PASS`);
  } catch (error) {
    console.error(stripVTControlCharacters(output));
    console.error('Raw terminal tail:', JSON.stringify(output.slice(-8000)));
    throw error;
  } finally {
    clearTimeout(trustTimer);
    if (!exited) terminal.kill();
  }
}
