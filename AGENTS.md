# postrelay
Self-hosted public-post notifications to Discord; GitHub: `shieikan/postrelay`.
status: active

## Runtime and verification
- Python runtime and dependencies: [pyproject.toml](pyproject.toml). Development tools: `python3 -m pip install --require-hashes -r requirements-dev.txt`.
- Documentation: `git diff --check`.
- Python/server changes: `python3 -B -m unittest discover -s tests -v`, `ruff check --select F postrelay scripts integrations/angelic tests`, `git diff --check`.
- Browser changes: `node --test tests/notification-settings.test.cjs`, `node --check web/app.js`, `node --check web/notification-settings.js`.
- Cloudflare changes: in `cloudflare/`, run `npm ci`, `npm test`, `npm run build`, `npm audit --audit-level=high`.
- CI and container checks: [.github/workflows/ci.yml](.github/workflows/ci.yml) and [.github/workflows/cloudflare.yml](.github/workflows/cloudflare.yml).

## Service boundaries
- Live setup, delivery and deployment can contact X, Discord or hosting accounts; local tests do not authorize those effects.
- Keep notification payloads, webhook URLs, ingress tokens and runtime databases out of tracked files.

## Read when relevant
- Server setup: [docs/server.md](docs/server.md).
- Cloudflare deployment: [docs/cloudflare.md](docs/cloudflare.md).
- Security and private reporting: [SECURITY.md](SECURITY.md).
