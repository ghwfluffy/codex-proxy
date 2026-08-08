# Model Gateway

An OAuth-protected, OpenAI-compatible model gateway for private service meshes.
It supports per-user API keys, budgets, rate limits, metadata-only usage metrics,
and an optional owner-only Codex App Server backend.

Deployment hostnames and public path prefixes are deliberately not part of this
repository. Configure them with `PUBLIC_URL` and `APP_BASE_PATH` in the owning
deployment repository.

See `docs/architecture.md` and `docs/development.md`.
