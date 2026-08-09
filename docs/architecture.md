# Architecture

The gateway exposes an OpenAI-compatible API on an internal service network and
an OAuth-protected management dashboard through a deployment-configured public
base path. It has no production hostname or path knowledge.

Two upstream classes are intentionally isolated. User-created keys call a paid
OpenAI API project and have hard monthly budgets. A configured owner may create
service keys backed by one Codex subscription through the official `codex
app-server` stdio protocol. Subscription credentials are never shared with
ordinary users.

Codex subscription service keys belong to the configured owner account. A
bootstrap key may be inserted before that OAuth user exists; migration startup
or the owner's next login claims the key and its historical usage for the owner.
New owner-created service keys are account-owned immediately.

The PostgreSQL metrics store contains request metadata and token/cost counters,
never prompts or generated content. The Codex home is a separate protected
persistent mount because official App Server authentication and conversation
rollouts require local state.

Gateway tokens are high-entropy bearer tokens. Only an HMAC verifier and short
display prefix are stored. Raw tokens are returned once at creation.

Prompt caching is caller-visible and upstream-authoritative. The gateway keeps
standard usage details, including cached and cache-write tokens, and calculates
paid-API estimates from effective-dated prices. It never labels expected tokens
as cached without an upstream usage report.
