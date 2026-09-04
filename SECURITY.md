# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a security vulnerability. Use GitHub's private security advisory flow for this repository, or contact the repository maintainers privately with a reproduction and impact description.

## Deployment guidance

- Keep the local API on loopback unless a trusted HTTPS proxy is in front of it.
- Set `PANEL_REQUIRE_PAIRING=1` for any phone-accessible deployment.
- Treat Bridge tokens and the local device store as secrets.
- Prefer a private Tailscale or WireGuard network for the advanced remote Bridge.
- Revoke unknown devices and rotate tokens after a suspected leak.
