# Development

Install dependencies with `npm run install:all`, configure the API environment,
run PostgreSQL migrations with `npm --prefix api run migrate`, and start API and
web development servers separately.

The default base path is empty and the default auth mode is standalone. Real
deployments should use OAuth and inject their public path from their deployment
repository.

Run `./scripts/validate.sh` before committing.
