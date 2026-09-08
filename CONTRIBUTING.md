# Contributing

Thanks for helping improve Vibe Coding Panel.

## Local setup

1. Install Node.js 24 LTS (Vite requires 20.19+ or 22.12+ on those release lines).
2. Run `npm install`.
3. Run `npm test`, `npm run check`, and `npm run build` before opening a pull request.
4. Use `npm run dev` for the Vite client and local API during development.

## Pull requests

Keep changes focused and explain the user workflow they improve. For UI changes, check both a desktop viewport and a narrow phone viewport. Do not commit `.env`, `.vibe-panel`, `dist`, local device stores, Whisper models, or credentials.

Voice changes should be tested with a real browser recording when possible. Keep transcription provider changes local and configurable; do not hardcode phrase corrections.

## Commit style

Use a short imperative subject with one of `feat:`, `fix:`, `docs:`, `chore:`, or `refactor:`.
