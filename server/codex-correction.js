import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { CodexRuntime } from './codex-runtime.js';

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
