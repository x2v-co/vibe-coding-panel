# Voice recording fix deployment — 2026-09-08

- Public app: https://vibe.toolkit.fun/app
- Production source is `/opt/vibe-coding-panel` on the Relay host, without Git metadata. It contains newer UI features than this test checkout. Do not replace its frontend with this checkout's `dist`.
- Only `src/App.tsx` recording lifecycle and new `src/recording.ts` were changed in production. Micro controls, agent selection, landing/download pages and other assets were preserved.
- Staged source/build: `/tmp/vibe-prod.vtuD` on the development Mac.
- Server backup: `/opt/vibe-panel-backups/voice-20260908/src` (original source), `dist-before` (original deployed static files).
- Rollback image: `vibe-coding-panel-relay:before-voice-20260908`.
- Updated image: `vibe-coding-panel-relay:voice-20260908`, also tagged `latest`. This layers only static files over the previous image.
- Running container was updated assets-first, then index by rename. Relay was not restarted; old hashed assets remain available.
- Updated public bundle: `index-BCDGe1PN.js`.

Verification: 28 local tests and both local/staged TypeScript checks/builds passed. Chromium MediaRecorder generated a valid recording, uploaded exactly once, and rejected a short recording without uploading. Public Relay forwarded synthetic Mandarin MP4 and WebM to local Whisper successfully (HTTP 200); truncated input returned HTTP 422 without Whisper inference. Landing, download and app routes loaded without JS errors.

The user's existing Mac Connector process predates `audio-decode.js` and must be restarted to load the server fix. Do not stop it silently: in-memory running tasks/session state could be lost. Refresh/reopen the phone page to load the frontend fix. Actual phone microphone capture remains to be confirmed by the user. The automated WebKit recording test could not complete with a synthetic audio stream; it is not evidence of an iPhone pass.
