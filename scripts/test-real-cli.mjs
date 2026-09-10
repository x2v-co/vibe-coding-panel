// Runs official CLIs against a loopback provider. No account or paid inference required.
// Tests persistence/protocol compatibility, plus optional PTY/ConPTY handoff.
// The local provider fixture does not test model quality or account authentication.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, appendFile, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import spawn from 'cross-spawn';
import { NativeSessions } from '../server/native-sessions.js';
import { checkInteractiveTerminal } from './interactive-terminal.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'vibe-real-cli-'));
const workspace = path.join(root, 'workspace with spaces');
const other = path.join(root, 'other');
const codexHome = path.join(root, 'codex');
const claudeHome = path.join(root, 'claude');
await Promise.all([workspace, other, codexHome, claudeHome].map(dir => mkdir(dir)));
// An allowlist intentionally excludes inherited provider credentials, hooks and agents.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|LANG|LC_ALL)$/i.test(key)));
Object.assign(env, {
  HOME: root, USERPROFILE: root, CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome,
  ANTHROPIC_API_KEY: 'local-compatibility-only', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  PANEL_CODEX_BIN: process.env.PANEL_CODEX_BIN || 'codex',
  PANEL_CLAUDE_BIN: process.env.PANEL_CLAUDE_BIN || 'claude',
});
const requests = [];
let observeRequest = async () => {};
const server = createServer(async (req, res) => {
  try {
    let body = ''; for await (const chunk of req) body += chunk;
    const input = body ? JSON.parse(body) : {};
    if (req.url.includes('count_tokens')) {
      res.setHeader('Content-Type', 'application/json'); res.end('{"input_tokens":10}'); return;
    }
    const provider = req.url.includes('messages') ? 'claude' : 'codex';
    requests.push({ provider, input });
    await observeRequest(provider, input);
    const reply = 'COMPATIBILITY_READY';
    res.setHeader('Content-Type', 'text/event-stream');
    const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    if (provider === 'claude') {
      event('message_start', { message: { id: 'msg_compat', type: 'message', role: 'assistant', model: input.model,
        content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
      event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: reply } });
      event('content_block_stop', { index: 0 });
      event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } });
      event('message_stop', {});
    } else {
      const item = { id: 'msg_compat', type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: reply, annotations: [] }] };
      event('response.created', { response: { id: 'resp_compat', status: 'in_progress', output: [] } });
      event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
      event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: reply });
      event('response.output_item.done', { output_index: 0, item });
      event('response.completed', { response: { id: 'resp_compat', status: 'completed', output: [item],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } });
    }
    res.end();
  } catch (error) { res.statusCode = 500; res.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/v1`;
env.ANTHROPIC_BASE_URL = url.slice(0, -3);
await writeFile(path.join(codexHome, 'config.toml'), `model = "compatibility"\nmodel_provider = "compatibility"\n[model_providers.compatibility]\nname = "Local compatibility test"\nbase_url = "${url}"\nwire_api = "responses"\nrequires_openai_auth = false\n`);
function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      code === 0 ? resolve(stdout) : reject(new Error(`${path.basename(bin)} exited ${code}: ${stderr}\n${stdout.slice(-4000)}`));
    });
  });
}
const sessions = new NativeSessions({ env });
try {
  for (const provider of ['codex', 'claude']) {
    const bin = env[provider === 'codex' ? 'PANEL_CODEX_BIN' : 'PANEL_CLAUDE_BIN'];
    console.log((await run(bin, ['--version'])).trim());
    const args = provider === 'codex' ? ['exec', '--skip-git-repo-check', '--json']
      : ['-p', '--setting-sources', '', '--output-format', 'json', '--tools', '', '--model', 'claude-sonnet-4-6'];
    await run(bin, [...args, 'Remember FIRST_TURN_MARKER. Reply COMPATIBILITY_READY.']);
    const listed = await sessions.list(provider, workspace);
    assert.equal(listed.sessions.length, 1, `${provider}: real session discovered`);
    const id = listed.sessions[0].id;
    const first = await sessions.read(provider, workspace, id);
    assert(first.messages.some(m => m.role === 'user' && m.text.includes('FIRST_TURN_MARKER')));
    assert(first.messages.some(m => m.role === 'assistant' && m.text.includes('COMPATIBILITY_READY')));
    assert.equal(first.canResume, true);
    assert.equal((await sessions.list(provider, other)).sessions.length, 0);
    await assert.rejects(sessions.read(provider, other, id));
    if (process.env.PANEL_TEST_INTERACTIVE_TERMINAL === '1') {
      if (provider === 'codex') await appendFile(path.join(codexHome, 'config.toml'),
        `\n[projects.${JSON.stringify(workspace)}]\ntrust_level = "trusted"\n`);
      await checkInteractiveTerminal({ provider, bin, id, workspace, env, sessions, requests });
    }
    const before = requests.length;
    const ownership = [];
    observeRequest = async (activeProvider, input) => {
      if (activeProvider === provider) {
        const canResume = (await sessions.read(provider, workspace, id)).canResume;
        ownership.push(canResume);
        if (canResume) {
          console.error('Unexpected available fixture session:', { provider, input });
          if (provider === 'claude') {
            const dir = path.join(claudeHome, 'sessions');
            for (const file of await readdir(dir).catch(() => [])) {
              if (/^\d+\.json$/.test(file)) console.error('Fixture metadata:', await readFile(path.join(dir, file), 'utf8'));
            }
          }
        }
      }
    };
    const resume = provider === 'codex' ? ['exec', 'resume', '--skip-git-repo-check', '--json', id]
      : [...args, '--resume', id];
    await run(bin, [...resume, 'SECOND_TURN_MARKER. What did I ask you to remember?']);
    observeRequest = async () => {};
    assert(ownership.length > 0 && ownership.every(canResume => canResume === false), `${provider}: a real active writer must block resume`);
    const sent = requests.slice(before).filter(r => r.provider === provider);
    assert(sent.length > 0, `${provider}: resume made a real provider request`);
    assert(sent.some(r => JSON.stringify(r.input).includes('FIRST_TURN_MARKER')), `${provider}: resume restores first turn context`);
    assert(sent.some(r => JSON.stringify(r.input).includes('COMPATIBILITY_READY')), `${provider}: resume restores assistant context`);
    const resumed = await sessions.read(provider, workspace, id);
    assert(resumed.messages.some(m => m.role === 'user' && m.text.includes('SECOND_TURN_MARKER')));
    assert.equal(resumed.canResume, true);
    assert.equal((await sessions.list(provider, workspace)).sessions.length, 1, 'resume must keep the same session');
    console.log(`${provider}: create/list/read/workspace isolation/resume/history/active and released ownership passed`);
  }
} finally {
  sessions.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  console.log('CLI fixture server, sessions and temporary files cleaned up');
}
