# Entitlement Assistant — system

|                |                                                                                                                                                                                                            |
| :------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**    | How to run, test, and develop the code. The design lives in [`../../tech-docs/`](../../tech-docs/).                                                                                                        |
| **References** | • Structure and rules: [`../../AI_AS_ARCHITECT.md`](../../AI_AS_ARCHITECT.md), [`../../AI_AS_DEVELOPER.md`](../../AI_AS_DEVELOPER.md)<br>• API: [`../../tech-docs/api/api.md`](../../tech-docs/api/api.md) |

## Run locally

```sh
npm install
npm run db:up                                   # PostgreSQL 17 in Docker, port 54329
export DATABASE_URL=postgres://postgres:local-development-only@localhost:54329/entitlement_assistant
npm run db:migrate && npm run db:seed           # schema, reference data, demo employees
npm run secrets:local                           # .dev.vars with fresh keys (never committed)
npm run dev                                     # builds the UI, then wrangler dev on http://localhost:8787
```

Demo employees (password `<name>-demo-password` in a local database only; see Deploy): `alex@provider.example` (representative, level 1),
`blair@provider.example` (level 2), `sam@provider.example` (supervisor), `drew@provider.example` (finance);
`casey@` and `dana@` cannot sign in (suspended).

## Deploy

The demo passwords are public, so a database that is not local is seeded only with generated passwords
(`seed` refuses otherwise). As the database owner:

```sh
npm run seed:passwords        # .env.seed-passwords (git-ignored): email=password, e.g. alex-k7m2-x9qp-4hdr
DATABASE_URL=<owner connection string> npm run db:migrate
DATABASE_URL=<owner connection string> SEED_PASSWORDS_FILE=.env.seed-passwords npm run db:seed
```

Two guards depend on how Hyperdrive is created, so it is created exactly this way:

1. **A login role that can do no more than the application role** (CM-7, CM-13). Every request also runs
   `SET LOCAL ROLE entitlement_assistant_app` inside its transaction, which holds under Hyperdrive's
   transaction pooling; the login role makes that defense in depth. As the database owner:

   ```sql
   CREATE ROLE entitlement_assistant_worker LOGIN PASSWORD '<generated, kept in a password manager>'
     IN ROLE entitlement_assistant_app;
   ```

2. **Query caching disabled.** Every request loads the principal fresh (CM-16); a cached read could show a
   suspended employee as active for up to a minute.

   ```sh
   npx wrangler hyperdrive create entitlement-assistant \
     --connection-string="postgres://entitlement_assistant_worker:<password>@<host>/<database>?sslmode=require" \
     --caching-disabled
   ```

   Put the returned id in `wrangler.jsonc`. Put the secrets (`APPLICATION_ORIGIN`, `SESSION_SIGNING_KEY` and its
   id, `AUDIT_HASH_KEY` and its id, `IDENTIFIER_HASH_KEY`) in a git-ignored `.env.production-secrets.json`, kept
   in a password manager because the audit chain cannot be verified without its key, and deploy with
   `npm run ui:build && npx wrangler deploy --secrets-file .env.production-secrets.json`.

## Checks

```sh
npm run check     # Biome, TypeScript (server and UI), dependency-cruiser, Vitest
```

Tests need the Docker database; each test runs on its own database cloned from a migrated, seeded template.
