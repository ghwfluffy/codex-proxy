# Development

Install dependencies with `npm run install:all`, configure the API environment,
run PostgreSQL migrations with `npm --prefix api run migrate`, and start API and
web development servers separately.

The default base path is empty and the default auth mode is standalone. Real
deployments should use OAuth and inject their public path from their deployment
repository.

`FEDERATED_APPS` is optional JSON containing deployment-owned app links with
`slug`, `name`, `baseUrl`, and optional `description` and `icon` fields. Leave it
unset for standalone development, which retains the deployment-neutral header.
OAuth deployments render the shared authenticated banner even when the
inventory is empty, but its Apps selector appears only when entries exist.

Run `./scripts/validate.sh` before committing.
