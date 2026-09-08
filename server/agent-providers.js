import { sync as spawnSync } from 'cross-spawn';
import { readFileSync } from 'node:fs';

export const agentProviders = {
  codex: { id: 'codex', label: 'Codex', envBin: 'PANEL_CODEX_BIN', defaultBin: 'codex' },
  claude: { id: 'claude', label: 'Claude Code', envBin: 'PANEL_CLAUDE_BIN', defaultBin: 'claude' },
};

export function normalizeAgentProvider(value, fallback = 'codex') {
  const provider = String(value || '').trim().toLowerCase();
  return agentProviders[provider] ? provider : fallback;
}

export function defaultAgentProvider(env = process.env) {
  if (env.PANEL_AGENT_PROVIDER) return normalizeAgentProvider(env.PANEL_AGENT_PROVIDER);
  try {
    const settings = JSON.parse(readFileSync(new URL('../.vibe-panel/connector.json', import.meta.url), 'utf8'));
    return normalizeAgentProvider(settings.agentProvider);
  } catch (error) {
    if (error.code === 'ENOENT') return 'codex';
    throw new Error('无法读取 .vibe-panel/connector.json，请检查 JSON 格式。');
  }
}

export function providerBinary(provider, env = process.env) {
  const definition = agentProviders[normalizeAgentProvider(provider)];
  return env[definition.envBin] || definition.defaultBin;
}

export function probeAgentProviders(env = process.env) {
  return Object.values(agentProviders).map((provider) => {
    const executable = providerBinary(provider.id, env);
    const result = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 5000, env });
    let authenticated = false;
    if (!result.error && result.status === 0) {
      const authArgs = provider.id === 'claude' ? ['auth', 'status'] : ['login', 'status'];
      const auth = spawnSync(executable, authArgs, { encoding: 'utf8', timeout: 10_000, env });
      authenticated = !auth.error && auth.status === 0;
      if (provider.id === 'claude' && authenticated) {
        try { authenticated = JSON.parse(auth.stdout).loggedIn === true; } catch { authenticated = false; }
      }
    }
    return {
      id: provider.id,
      label: provider.label,
      available: !result.error && result.status === 0,
      authenticated,
      version: result.status === 0 ? String(result.stdout || result.stderr || '').trim().split(/\r?\n/)[0] : undefined,
    };
  });
}

export function buildAgentInvocation(provider, { prompt, cwd, threadId, resume = false }, env = process.env) {
  const selected = normalizeAgentProvider(provider);
  if (selected === 'claude') {
    const permissionModes = new Set(['acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk', 'plan']);
    const configuredMode = String(env.PANEL_CLAUDE_PERMISSION_MODE || 'acceptEdits');
    const permissionMode = permissionModes.has(configuredMode) ? configuredMode : 'acceptEdits';
    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode', permissionMode,
    ];
    if (resume && threadId) args.push('--resume', threadId);
    return { provider: selected, command: providerBinary(selected, env), args, cwd };
  }

  const args = resume
    ? ['exec', 'resume', threadId, prompt, '--json', '--skip-git-repo-check']
    : ['exec', prompt, '--json', '--skip-git-repo-check', '--approve-for-me', '--cd', cwd];
  return { provider: selected, command: providerBinary(selected, env), args, cwd };
}

function contentText(content) {
  if (!Array.isArray(content)) return '';
  return content.filter((item) => item?.type === 'text').map((item) => item.text || '').join('');
}

function toolDescription(block) {
  const name = block?.name || 'Tool';
  const input = block?.input || {};
  const detail = input.command || input.file_path || input.path || input.query || '';
  return detail ? `${name}: ${detail}` : name;
}

export function parseAgentLine(provider, job, line, emit) {
  if (!line.trim()) return;
  let data;
  try {
    data = JSON.parse(line);
  } catch {
    emit({ type: 'log', text: line });
    return;
  }

  if (provider === 'claude') {
    if (data.session_id) job.threadId = data.session_id;
    if (data.type === 'system' && data.subtype === 'init') {
      emit({ type: 'progress', text: 'Claude Code 已连接 Workspace' });
      return;
    }
    if (data.type === 'stream_event') {
      const event = data.event || {};
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        job.result += event.delta.text || '';
        emit({ type: 'message', text: job.result });
      } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        emit({ type: 'tool', text: `正在使用 ${toolDescription(event.content_block)}`, status: 'in_progress' });
      }
      return;
    }
    if (data.type === 'assistant') {
      const blocks = data.message?.content || [];
      const text = contentText(blocks);
      if (text && text !== job.result) {
        job.result = text;
        emit({ type: 'message', text });
      }
      for (const block of blocks.filter((item) => item?.type === 'tool_use')) {
        emit({ type: 'tool', text: `正在使用 ${toolDescription(block)}`, status: 'in_progress' });
      }
      return;
    }
    if (data.type === 'result') {
      if (typeof data.result === 'string' && data.result && data.result !== job.result) {
        job.result = data.result;
        emit({ type: 'message', text: data.result });
      }
      if (data.is_error) {
        job.agentError = data.result || 'Claude Code 返回错误';
        emit({ type: 'log', text: job.agentError });
      }
      return;
    }
    return;
  }

  if (data.thread_id && !job.threadId) job.threadId = data.thread_id;
  if (data.type === 'thread.started') job.threadId = data.thread_id;
  const item = data.item || {};
  const type = item.type || data.type || 'event';
  if (type === 'agent_message') {
    const text = item.text || item.content || '';
    job.result = text;
    emit({ type: 'message', text });
  } else if (type === 'reasoning') {
    emit({ type: 'progress', text: item.text || '正在思考下一步' });
  } else if (type === 'command_execution') {
    const phase = item.status === 'completed' ? '已完成命令' : '正在执行命令';
    emit({ type: 'tool', text: `${phase}: ${item.command || ''}`, status: item.status });
  } else if (data.type === 'turn.completed') {
    job.agentError = null;
    emit({ type: 'progress', text: '正在整理结果' });
  } else if (data.type === 'turn.failed') {
    job.agentError = data.error?.message || 'Codex 任务失败';
    emit({ type: 'log', text: job.agentError });
  } else if (data.type === 'error') {
    job.agentError = data.message || data.error?.message || 'Codex 返回错误';
    emit({ type: 'log', text: job.agentError });
  }
}
