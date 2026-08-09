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

The authenticated dashboard consumes the shared `vendor/federated-banner`
package. Deployments may provide a non-secret `FEDERATED_APPS` JSON inventory;
the existing `/api/v1/auth/me` response returns that inventory and an account
settings link to the web client. Only configured entries appear, and banner
sign-out uses the dashboard's existing local session endpoint. An OAuth account
settings link keeps the shared header and account controls visible even if the
app inventory is empty, while the Apps selector appears only for configured
entries. Standalone deployments retain their deployment-neutral header. Web
tests exercise the component's actual shadow DOM, open the app selector, and
verify configured navigation links.

Gateway tokens are high-entropy bearer tokens. Only an HMAC verifier and short
display prefix are stored. Raw tokens are returned once at creation.

Prompt caching is caller-visible and upstream-authoritative. The gateway keeps
standard usage details, including cached and cache-write tokens, and calculates
paid-API estimates from effective-dated prices. It never labels expected tokens
as cached without an upstream usage report.
