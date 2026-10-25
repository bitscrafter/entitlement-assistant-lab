# Entitlement Agent — system

|                |                                                                                                                                                                                                            |
| :------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**    | How to run, test, and develop the code. The design lives in [`../../tech-docs/`](../../tech-docs/).                                                                                                        |
| **References** | • Structure and rules: [`../../AI_AS_ARCHITECT.md`](../../AI_AS_ARCHITECT.md), [`../../AI_AS_DEVELOPER.md`](../../AI_AS_DEVELOPER.md)<br>• API: [`../../tech-docs/api/api.md`](../../tech-docs/api/api.md) |

## Run locally

```sh
npm install
npm run db:up                                   # PostgreSQL 17 in Docker, port 54329
export DATABASE_URL=postgres://postgres:local-development-only@localhost:54329/entitlement_agent
npm run db:migrate && npm run db:seed           # schema, reference data, demo employees
npm run secrets:local                           # .dev.vars with fresh keys (never committed)
npm run dev                                     # builds the UI, then wrangler dev on http://localhost:8787
```

Demo employees (password `<name>-demo-password`): `alex@provider.example` (representative, level 1),
`blair@provider.example` (level 2), `sam@provider.example` (supervisor), `drew@provider.example` (finance);
`casey@` and `dana@` cannot sign in (suspended).

## Deploy

Two guards depend on how Hyperdrive is created, so it is created exactly this way:

1. **A login role that can do no more than the application role** (CM-7, CM-13). Every request also runs
   `SET LOCAL ROLE entitlement_agent_app` inside its transaction, which holds under Hyperdrive's
   transaction pooling; the login role makes that defense in depth. As the database owner:

   ```sql
   CREATE ROLE entitlement_agent_worker LOGIN PASSWORD '<generated, kept in a password manager>'
     IN ROLE entitlement_agent_app;
   ```

2. **Query caching disabled.** Every request loads the principal fresh (CM-16); a cached read could show a
   suspended employee as active for up to a minute.

   ```sh
   npx wrangler hyperdrive create entitlement-agent \
     --connection-string="postgres://entitlement_agent_worker:<password>@<host>/<database>?sslmode=require" \
     --caching-disabled
   ```

   Put the returned id in `wrangler.jsonc`, then set the secrets (`SESSION_SIGNING_KEY`, its id, the audit and
   identifier hash keys) with `npx wrangler secret put`, and deploy with `npm run ui:build && npx wrangler deploy`.

## Checks

```sh
npm run check     # Biome, TypeScript (server and UI), dependency-cruiser, Vitest
```

Tests need the Docker database; each test runs on its own database cloned from a migrated, seeded template.
