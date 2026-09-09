#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('fixture 1.0'); process.exit(0); }
if (args.includes('status')) { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
const emit = (data) => process.stdout.write(JSON.stringify(data) + '\n');
const result = JSON.stringify({ args, cwd: process.cwd(), codexHome: process.env.CODEX_HOME, credentialInherited: process.env.PANEL_TEST_CREDENTIAL === 'fixture-credential' });
emit({ type: 'thread.started', thread_id: 'fixture-thread' });
if (args.includes('auth-failure')) {
  process.stderr.write('ERROR failed to refresh available models: Authorization validation failed\n');
  emit({ type: 'turn.failed', error: { message: 'stream disconnected before completion' } });
  process.exitCode = 1;
} else if (args.includes('quota-failure')) {
  process.stderr.write('usage_limit_reached: quota exceeded\n');
  emit(args.includes('--output-format') ? { type: 'result', is_error: true, result: 'stream disconnected before completion' } : { type: 'turn.failed', error: { message: 'stream disconnected before completion' } });
  process.exitCode = 1;
} else if (args.includes('--output-format')) {
  emit({ type: 'result', session_id: args.includes('--resume') ? args[args.indexOf('--resume') + 1] : 'fixture-thread', result });
} else {
  if (args.includes('retry-success')) emit({ type: 'error', message: 'Reconnecting... 1/5' });
  emit({ type: 'item.completed', item: { type: 'agent_message', text: result } });
  emit({ type: 'turn.completed' });
}
if (args.includes('wait-for-stop')) setInterval(() => {}, 1000);

if (args.includes('stop-with-exit-code')) {
  process.on('SIGINT', () => {
    emit({ type: 'result', is_error: true, result: 'Interrupted by user' });
    process.exit(1);
  });
  setInterval(() => {}, 1000);
}
