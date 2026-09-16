import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { CodexRuntime } from './codex-runtime.js';
import spawn from 'cross-spawn';

// Read resolved Codex settings without starting a task or touching its session.
export async function readCodexCorrectionConfig(env = process.env, { timeoutMs = 25000 } = {}) {
  const runtime = new CodexRuntime(env);
  const timer = setTimeout(() => runtime.close(new Error('Codex 纠错配置读取超时')), timeoutMs);
  try {
    await runtime.start();
    return (await runtime.request('config/read', { includeLayers: false })).config;
  } finally { clearTimeout(timer); runtime.close(); }
}

export async function codexCorrectionConfig(env = process.env, readConfig = readCodexCorrectionConfig, options = {}) {
  const config = await readConfig(env, options);
  const providerId = env.PANEL_CODEX_MODEL_PROVIDER || config.model_provider || 'openai';
  const provider = config.model_providers?.[providerId];
  if (!provider && providerId !== 'openai') throw new Error('Codex 模型服务配置不可用');
  if (provider?.wire_api && provider.wire_api !== 'responses') throw new Error('Codex 纠错暂不支持此接口格式');
  let token = provider?.env_key ? env[provider.env_key] : provider?.experimental_bearer_token;
  if (provider?.env_key && !token) throw new Error('Codex 模型服务缺少指定的认证环境变量');
  if (!token && (!provider || provider.requires_openai_auth)) {
    let auth = {};
    try { auth = JSON.parse(await readFile(path.join(env.CODEX_HOME || path.join(homedir(), '.codex'), 'auth.json'), 'utf8')); } catch {}
    token = env.OPENAI_API_KEY || auth.OPENAI_API_KEY;
    // Do not send ChatGPT OAuth tokens to an API endpoint or another provider.
    if (!token) throw new Error('当前 Codex 登录方式尚未接入文字纠错');
  }
  const base = new URL(provider?.base_url || env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) throw new Error('Codex 纠错地址无效');
  base.pathname = base.pathname.replace(/\/$/, '') + '/responses';
  for (const [key, value] of Object.entries(provider?.query_params || {})) base.searchParams.set(key, value);
  const headers = { ...provider?.http_headers };
  for (const [key, name] of Object.entries(provider?.env_http_headers || {})) if (env[name]) headers[key] = env[name];
  if (token) headers.Authorization = `Bearer ${token}`;
  const model = config.model;
  if (!model) throw new Error('Codex 未配置纠错所需模型');
  return { url: base.href, headers, model };
}

export async function runCodexCorrection(text, instructions, { env = process.env, timeoutMs = 25000, fetchImpl = fetch, resolveConfig = codexCorrectionConfig } = {}) {
  // Normal requests always use Codex's own authentication and provider resolution.
  if (resolveConfig === codexCorrectionConfig) {
    return runCodexCliCorrection(text, instructions, { env, timeoutMs });
  }
  const started = Date.now();
  const config = await resolveConfig(env, undefined, { timeoutMs });
  const remaining = timeoutMs - (Date.now() - started);
  if (remaining <= 0) throw new Error('Codex 纠错超时');
  const response = await fetchImpl(config.url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(remaining),
    headers: { ...config.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.model, instructions, input: JSON.stringify({ transcript: text }),
      tools: [], tool_choice: 'none', store: false, stream: false, max_output_tokens: 4096 }),
  });
  if (!response.ok) throw new Error(`Codex 纠错服务返回 ${response.status}`);
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 65536) throw new Error('Codex 纠错响应过大');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (payload.status !== 'completed' || !Array.isArray(payload.output) || payload.output.some(item => !['reasoning', 'message'].includes(item.type))) throw new Error('Codex 纠错结果不完整');
  const content = payload.output.filter(item => item.type === 'message').flatMap(item => item.content || []);
  if (content.some(item => item.type !== 'output_text')) throw new Error('Codex 纠错未返回文本');
  return JSON.stringify({ result: content.map(item => item.text).join('') });
}

export async function runCodexCliCorrection(text, instructions, { env = process.env, timeoutMs = 25000, readConfig = readCodexCorrectionConfig } = {}) {
  const started = Date.now();
  const config = await readConfig(env, { timeoutMs });
  const cwd = await mkdtemp(path.join(tmpdir(), 'vibe-codex-correction-'));
  try {
  return await new Promise((resolve, reject) => {
    const command = env.PANEL_CODEX_BIN || 'codex';
    const overrides = { approval_policy: 'never', web_search: 'disabled', project_doc_max_bytes: 0, developer_instructions: instructions, 'features.shell_tool': false, 'features.unified_exec': false, 'features.js_repl': false, 'features.apps': false, 'features.hooks': false };
    for (const name of Object.keys(config.mcp_servers || {})) overrides[`mcp_servers.${JSON.stringify(name)}.enabled`] = false;
    for (const name of Object.keys(config.plugins || {})) overrides[`plugins.${JSON.stringify(name)}.enabled`] = false;
    const args = ['exec', '--json', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', ...Object.entries(overrides).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`]), '-'];
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    let output = '', settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('Codex 纠错超时')); }, Math.max(1, timeoutMs - (Date.now() - started)));
    child.stdin.on('error', error => finish(error));
    child.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 65536) { child.kill('SIGKILL'); finish(new Error('Codex 纠错响应过大')); } });
    child.once('error', error => finish(error));
    child.once('close', code => {
      if (code !== 0) return finish(new Error('Codex CLI 纠错不可用'));
      try {
        const events = output.trim().split(/\r?\n/).map(line => JSON.parse(line));
        if (!events.some(event => event.type === 'turn.completed') || events.some(event => ['turn.failed', 'error'].includes(event.type) || (event.item && !['agent_message', 'reasoning'].includes(event.item.type)))) throw new Error('Codex 纠错结果不完整');
        const message = [...events].reverse().find(event => event.type === 'item.completed' && event.item?.type === 'agent_message');
        const result = message?.item?.text || message?.item?.content;
        if (typeof result !== 'string' || !result.trim()) throw new Error('Codex 纠错结果为空');
        finish(null, JSON.stringify({ result }));
      } catch (error) { finish(error); }
    });
    child.stdin.end(`${instructions}\n\n${JSON.stringify({ transcript: text })}`);
  });
  } finally { await rm(cwd, { recursive: true, force: true }); }
}
