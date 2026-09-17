# Release regression gate

A GitHub Release means packages are built; it does not mean the product website
or regional deployments have been updated. Record each result separately.

## Required automated checks

| User path | Executable gate | Scope |
| --- | --- | --- |
| Codex-only / Claude-only, logged in / logged out, probe failures | `server/agent-providers.test.js` | No dependency on the other CLI |
| Codex voice correction without API key or Claude | `scripts/test-real-cli.mjs` | Official pinned CLIs on all four CI platforms, local provider fixture; asserts no execution, file or delegation tools |
| Failed correction / tool attempt / provider switching | `server/codex-correction.test.js`, `server/transcript-correction.test.js` | Original text preserved; no cross-provider fallback |
| Workspace isolation, shared daemon ownership, release timeout | `server/native-sessions.test.js` | No signal to shared process; timeout never means success |
| Real terminal handoff and same-session continuation | CI `windows-terminal`, `linux-terminal` | Real PTY/ConPTY; Windows manual release |
| First controller scan and pairing identity | `server/regional-relays.test.js`, `server/controller-page.test.js` | Route, code and identity survive; phone pairing works |
| Network loss / uncertain writes / duplicate sends | `server/connection-monitor.test.js`, Relay and controller tests | Preserve draft; no implicit resubmit |
| Installed Connector package | CI package test on all four platforms | Launchers and bundled runtime |
| Actual deployed website | `scripts/verify-production.mjs` | Backend SHA, frontend SHA, JS/CSS HTTP success; healthy old code fails |

Run `npm test`, `npm run test:acceptance`, `npm run build`. The existing CI
CLI compatibility matrix also runs the real voice correction test automatically.
Model quality and real OAuth account validity are not simulated by the fixture.

## Required manual acceptance (never infer from CLI tests)

Record release SHA, device/browser, Connector version, result and evidence:

- Fresh phone browser: scan, pair, usable mobile layout; no horizontal page scroll.
- Existing phone: refresh/reconnect without pairing again; unsent draft survives.
- Codex-only with actual OAuth login: record, correct, review and explicitly send.
- Claude-only: record, correct, review and explicitly send.
- Codex App holding a session: manual-release guidance, no terminal-exit button;
  save drafts and quit the App, then observe same-session continuation.
- Phone background/foreground and Wi-Fi/mobile switch: recover without duplicate send.

These rows remain pending until actually performed; an automated build is not
physical-device or desktop-App verification.

## Deployment completion

1. All required CI checks and package assets must pass.
2. Deploy the explicit immutable revision to the intended website/region hosts.
3. Run `node scripts/verify-production.mjs FULL_SHA https://vibe.toolkit.fun https://vibe.tooluse.app`
   or dispatch **Verify deployed product** with the full SHA. This is a mandatory
   separate post-deployment gate, not an automatic regional deployment.
4. Verify Release contains all four Connector ZIPs and SHA256SUMS. Users need to
   update/restart their Connector for local backend fixes; website refresh alone
   does not install those fixes.
5. Report website, packages, regional nodes and physical acceptance separately.
   Any missing gate means that part of release is pending, not complete.
