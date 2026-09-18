# Public preview release checklist

Use this checklist after CI publishes a `relay-<full SHA>` release and before
announcing the build. A GitHub Release alone does not update the regional hosts.

## 1. Automated gates

```bash
npm test
npm run test:acceptance
npm run build
npm run test:browser
git diff --check
```

The CI run must pass the four platform package jobs, pinned Codex/Claude CLI
jobs, Windows ConPTY, Linux PTY and browser acceptance. Confirm the Release has
four Connector ZIPs, `relay-image.tar.gz` and `SHA256SUMS`.

## 2. Deploy and verify the immutable revision

Deploy the exact full SHA to the China and Global regional runtimes using the
host's reviewed deployment procedure. Keep the previous image and environment
backup until verification completes. Then run:

```bash
node scripts/verify-production.mjs FULL_SHA \
  https://vibe.toolkit.fun \
  https://vibe-relay-cn.toolkit.fun \
  https://vibe-relay-global.toolkit.fun
PANEL_EXPECTED_REVISION=FULL_SHA npm run check:regional
```

The first command checks backend revision, frontend assets, the Remote landing
page and the Remote artwork. The second checks health, admission state and
connector/inflight capacity without sending a task.

If health, artwork or capacity checks fail, stop the announcement and restore
the previous immutable image. Do not retry a potentially ambiguous task from a
phone until the computer confirms its state.

## 3. Preview safeguards

`PANEL_RELAY_ADMISSION_MODE=limited` allows existing connections while rejecting
new Connector registrations; `paused` rejects all new registrations. Use these
states during an incident or rollout, then return to `open` after both regions
pass the monitor. The Relay health endpoint exposes the current admission state
and capacity for an external cron, uptime check or host alert.

## 4. Focused physical smoke checks

Record the full SHA, Connector revision, OS and phone/browser. Verify one real
Codex path and one real Claude path: record, review corrected text, edit it,
send it, then exercise phone background/foreground and Wi-Fi/mobile switching.
The send is explicit and must produce one computer-side task. Record failures
with the release SHA and remove credentials, pairing URLs, source code and audio
before filing an issue.
