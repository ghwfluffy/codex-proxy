# Development

Install dependencies with `npm run install:all`, configure the API environment,
run PostgreSQL migrations with `npm --prefix api run migrate`, and start API and
web development servers separately.

The default base path is empty and the default auth mode is standalone. Real
deployments should use OAuth and inject their public path from their deployment
repository.

`FEDERATED_APPS` is optional JSON containing deployment-owned app links with
`slug`, `name`, `baseUrl`, and optional `description` and `icon` fields. Leave it
unset for standalone development; configured deployments expose the entries in
the shared authenticated banner.

Run `./scripts/validate.sh` before committing.
