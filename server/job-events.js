// Job event log shared by the SSE stream and job snapshots.
// Agent text streams arrive either as true deltas ({ delta: true }) or as
// cumulative snapshots of the message so far. Both are folded into the last
// message entry (same id) so the panel renders one growing bubble instead of
// a new line per update ("a", "ab", "abc", ...).

export const maxJobEvents = 500;

export function mergeMessageEvent(last, event) {
  if (event?.type !== 'message' || last?.type !== 'message' || typeof event.text !== 'string') return null;
  if (event.delta) return (last.text || '') + event.text;
  const previous = last.text || '';
  if (event.text.startsWith(previous) || previous.startsWith(event.text)) return event.text;
  return null;
}

export function pushJobEvent(job, event) {
  const last = job.events[job.events.length - 1];
  const merged = mergeMessageEvent(last, event);
  if (merged !== null) {
    if (merged === last.text) return last;
    job.revision += 1;
    last.text = merged;
    last.revision = job.revision;
    last.at = Date.now();
    for (const listener of job.listeners) listener(last);
    return last;
  }
  const { delta: _delta, ...rest } = event;
  job.revision += 1;
  const entry = { id: ++job.sequence, revision: job.revision, at: Date.now(), ...rest };
  job.events.push(entry);
  if (job.events.length > maxJobEvents) job.events.shift();
  for (const listener of job.listeners) listener(entry);
  return entry;
}
