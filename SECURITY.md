# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a security vulnerability. Use GitHub's private security advisory flow for this repository, or contact the repository maintainers privately with a reproduction and impact description.

## Deployment guidance

- Keep the local API on loopback unless a trusted HTTPS proxy is in front of it.
- Set `PANEL_REQUIRE_PAIRING=1` for any phone-accessible deployment.
- Treat Bridge tokens and the local device store as secrets.
- Prefer a private Tailscale or WireGuard network for the advanced remote Bridge.
- Revoke unknown devices and rotate tokens after a suspected leak.

## Agent credentials (local CLI only)

Vibe Panel reuses the Codex / Claude Code CLI already installed and authenticated
on the user's computer. Keep provider API keys in that local CLI login or in
machine-local environment variables. Do not paste official Anthropic, OpenAI,
Google, or other provider keys into a third-party hosted console BYOK form.

On 2026-10-17, OpenCode reported that about 1.4% of Console users who had linked
external providers were affected by a distillation-related incident; users also
reported that BYOK keys may have been exposed through a legacy system. OpenCode
stated that the open-source CLI itself was not affected.
Source: https://x.com/opencode/status/2111519637049319818 (2026-10-17).

Vibe Panel does not integrate OpenCode Console and does not ask you to store
keys there. Prefer the local Codex or Claude Code CLI paths documented in the
README.
