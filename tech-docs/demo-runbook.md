# Demo Runbook

| | |
| :--- | :--- |
| **Purpose** | What to do before, during, and after a demo of the deployed Entitlement Assistant, and how to keep it inside the account's included allowances. |
| **Audience** | The owner |
| **Live app** | <https://entitlement-assistant.jose-luis-rios.workers.dev> |
| **References** | • Usage guards: [`features/usage-guards/usage-guards.verification-spec.md`](features/usage-guards/usage-guards.verification-spec.md)<br>• Production readiness: [`production-readiness.md`](production-readiness.md)<br>• Demo script: on the bitscrafter.com page |

## Contents

1. [What the demo costs, and what caps it](#1-what-the-demo-costs-and-what-caps-it)
2. [Accounts](#2-accounts)
3. [Before a demo](#3-before-a-demo)
4. [During a demo](#4-during-a-demo)
5. [After a demo](#5-after-a-demo)
6. [Changing a setting](#6-changing-a-setting)
7. [When something goes wrong](#7-when-something-goes-wrong)
8. [Commands](#8-commands)

## 1. What the demo costs, and what caps it

The account is on the Workers Paid plan ($5 a month). Its included allowances:

| Meter | Included | What the demo uses | What caps it |
| --- | --- | --- | --- |
| Workers AI neurons | 10,000 a day (resets 00:00 UTC) | Every model call: an estimated 100 | **The app's daily allowance** (below): it stops calling the model at the budget |
| Worker requests | 10 million a month | A page load about 5; a chat message about 2; the approvals panel every 30 seconds | Sign-in for everything costly; 10 sign-in attempts a minute per IP address |
| Durable Objects, Workflows, Neon | Far above a demo | Chats, approvals, the database | The caps above |

The app's caps all derive from one setting, `AI_NEURONS_PER_DAY` (default 10,000, the free daily allowance):

| Cap | Value | When reached |
| --- | --- | --- |
| Model calls a day, every user together | 100 (10,000 ÷ `NEURONS_PER_MODEL_CALL` 100) | The assistant answers "The assistant's daily allowance for this demo is used up; try again tomorrow (UTC)." Nothing is spent. |
| Messages a day, per employee | 40 (40% of the model calls) | The chat closes with "You reached today's message limit for this demo." |
| Per message | at most 5 model calls, 1,024 output tokens each; the model reads the latest 20 messages | — |

Cloudflare offers no hard spending limit, so keep a **billing notification** (Billing → Notifications) at about $5.50: it tells you if anything ever passes the plan.

Running evaluations or live checks spends the same daily allowance as visitors: run them after 00:00 UTC, on a day without a demo.

## 2. Accounts

| Accounts | For | Roles |
| --- | --- | --- |
| `cf-alex`, `cf-blair`, `cf-morgan`, `cf-sam` `@provider.example` | Cloudflare's reviewers | representative level 1 · representative level 2 · supervisor level 2 · supervisor level 1 |
| `bc-alex`, `bc-blair`, `bc-morgan`, `bc-sam` `@provider.example` | The bitscrafter.com page's demo | the same |
| `alex`, `blair`, `sam`, `morgan`, … `@provider.example` | The fixtures of the specs and the evaluations | as in the specs |

Their passwords are 24-character generated secrets (the fixtures' are shorter) in `typescript/system/.env.seed-passwords` (git-ignored, mode 600). Read them there yourself; send them privately (the job application, a password manager share); never paste them in a chat whose transcript is published, in the repository, or on a page. A reset keeps the same passwords.

Two accounts are needed to show an approval: nobody approves a change they requested or confirmed.

## 3. Before a demo

1. **Reset the data** (optional, but the demo is predictable afterwards): grants pile up from earlier demos, and a feature already granted is refused as "already included". From `typescript/system`:

   ```bash
   DATABASE_URL="$(sed -n 's/^NEON_OWNER_URL=//p' .env.neon | sed -E "s/^['\"]//; s/['\"]$//")" \
   SEED_PASSWORDS_FILE=.env.seed-passwords NODE_OPTIONS=--dns-result-order=ipv4first \
   npm run demo:reset -- --yes
   ```

   It ends with `Reset: 17 migrations, 165 seeded identifiers (fixture day …), policy set … active`. Everything in the database is replaced: cases, grants, approvals, the audit trail. The fixture dates move to today.
2. **Check the allowance:** the day's model calls are shared by everyone. If a demo matters, avoid running checks that day, and keep the assistant on (`AI_NEURONS_PER_DAY` above 0, §6).
3. **Sign in once** as the representative and the supervisor you will use, in two browsers (or a private window), so both are ready.
4. **Have the demo script** (the bitscrafter.com page) open.

## 4. During a demo

- Messages are limited to 20 a minute and 40 a day per employee; the day's model calls are shared.
- If the assistant answers the daily allowance text, the day's budget is spent: everything else (cases, the change request cards, the approvals panel) still works; the assistant answers again after 00:00 UTC.
- The assistant's tools only prepare: the CSR confirms on the card; the supervisor approves in the Approvals section (top of the workspace).

## 5. After a demo

- Nothing is required. To stop all model use until the next demo, set `AI_NEURONS_PER_DAY` to `0` (§6).
- If credentials were shown to an audience, change them: new passwords go into `.env.seed-passwords` (`npm run seed:passwords` writes the easy-to-type kind for every employee, and refuses while the file exists; the 24-character reviewer passwords were generated separately, so ask the assistant to regenerate them), then reset (§3). The new passwords hold from the reset.

## 6. Changing a setting

The settings are in `typescript/system/wrangler.jsonc` under `vars`:

| Setting | Default | Meaning |
| --- | --- | --- |
| `AI_NEURONS_PER_DAY` | `10000` | The day's AI budget; every usage cap derives from it. `0` turns the assistant off (the kill switch). |
| `NEURONS_PER_MODEL_CALL` | `100` | The estimate behind the caps: calibrate it as the dashboard's neurons per day ÷ the day's model calls (logs). |
| `APPROVAL_WINDOW_SECONDS` | `259200` | How long an approval waits (72 hours). |
| `OUTBOX_RETRY_AFTER_SECONDS` | `60` | When the sweep redelivers an undelivered message. |

Two ways to change one:

| Way | How | Takes effect | Caveat |
| --- | --- | --- | --- |
| **Planned** | Edit `wrangler.jsonc`, then deploy (§8) | At deploy | Committed with the code: the right default |
| **Emergency** (the kill switch) | Dashboard → Workers & Pages → `entitlement-assistant` → Settings → Variables and Secrets → edit → Deploy | In seconds | The next `wrangler deploy` puts back the value in `wrangler.jsonc`: make the same change there |

## 7. When something goes wrong

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| "The assistant's daily allowance for this demo is used up" | The day's model calls are spent | Wait for 00:00 UTC; or raise `AI_NEURONS_PER_DAY` (billed past 10,000 neurons) |
| "You reached today's message limit for this demo" | That employee's 40 messages are spent | Use another account of the set |
| "The assistant could not answer (trace …)" | A model or tool failure; `4006` in the logs means Workers AI's own allocation | Read the logs (`npx wrangler tail`, or the dashboard's Logs) by the trace id |
| Sign-in answers "Too many requests" | 10 attempts a minute from this address | Wait a minute |
| A grant is refused "already included" | An earlier demo granted it | Reset (§3), or use another feature or account |
| Decisions fail after a deploy | The deployed policy set is not active | `npm run policies:register` (as the reset does), then deploy |

## 8. Commands

From `typescript/system`; `NODE_OPTIONS=--dns-result-order=ipv4first` avoids an IPv6 connect timeout on some networks.

| Task | Command |
| --- | --- |
| Check everything | `npm run check` |
| Deploy | `npm run ui:build && NODE_OPTIONS=--dns-result-order=ipv4first npx wrangler deploy` |
| Reset the demo data | §3 |
| Watch the logs | `NODE_OPTIONS=--dns-result-order=ipv4first npx wrangler tail` |
| Register the policy set alone | `DATABASE_URL=… npm run policies:register` |
