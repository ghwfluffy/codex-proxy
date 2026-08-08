# Agent Instructions

- Keep this repository deployment-neutral. Do not commit production hostnames,
  private route prefixes, deployment service aliases, or organization names.
- Read `docs/architecture.md` before changing authentication, proxy behavior,
  persistence, quotas, metrics, or Codex integration.
- Never log or persist model request/response bodies in usage telemetry.
- Raw gateway keys and upstream credentials are secrets. Store only gateway key
  hashes and one-time display the raw value.
- Update documentation and automated tests with behavioral changes.
- Run `./scripts/validate.sh` before handing changes back.
