# Production Readiness — Concerns Not Addressed

|  |  |
| :--- | :--- |
| **Purpose** | What a production version would have to address. Each entry states the **concern** and **why it matters**, not a solution: the right solution depends on requirements this project does not have. Grouped by subsystem, plus a cross-cutting section. |
| **Status** | Living list, extended with each subsystem and each review |
| **References** | • Proposal: [`entitlement-assistant-proposal.md`](entitlement-assistant-proposal.md)<br>• Data model: [`data-model/README.md`](data-model/README.md) |

## Contents

1. [Cross-cutting](#1-cross-cutting)
2. [Customer Identity](#2-customer-identity)
3. [Internal Identity](#3-internal-identity)
4. [Access](#4-access)
5. [Product](#5-product)
6. [Entitlement](#6-entitlement)
7. [Support](#7-support)
8. [Account](#8-account)
9. [Attribution](#9-attribution)
10. [Policy](#10-policy)

---

## 1. Cross-cutting

| Concern | Why it matters |
| --- | --- |
| **Protection of personal data at rest** | Names and emails are personal data. A database breach, a leaked backup, or an over-privileged operator exposes them. What is encrypted, with which keys, held where, and who can decrypt is unanswered. |
| **Lookup over protected data** | If personal data is encrypted, finding a customer by email still has to work, without the lookup itself revealing the data. |
| **Access to production data** | Which people and services can read the database, how that access is granted, reviewed, and revoked, and how it is itself audited. |
| **Breach detection and response** | How a compromise would be noticed, contained, and disclosed within regulatory deadlines. |
| **Data subject rights** | Privacy laws (GDPR, CCPA) give people the right to access and erase their data. Erasure conflicts with immutable audit records that reference the person. |
| **Retention** | How long each kind of data (identities, cases, conversations, audit records) is kept, and how it is disposed of. |
| **Adapters as namespaces** | Browser, chat, tools, and MCP share one principal in the demo. In production each inbound adapter is its own namespace, with its own credential type, allowed use cases, rate limits, and audit marker, so a use case can be allowed through one and refused through another. The channel is known from the route and protocol the server terminated, never from a client header; it enters the decision as a context attribute (`context.channel`), so effective rights are what the principal holds intersected with what the channel allows, and every audit record names its channel. |
| **MCP adapter** | External AI clients reach the same use cases through an MCP server behind OAuth; it needs client registration, scopes mapped to permissions, and per-client audit attribution. |
| **API limits and evolution** | Rate limits per endpoint and per employee, versioning of endpoints and tools, pagination beyond fixed limits, and webhooks for external systems. |
| **Data residency** | Some customers require their data to stay in a given region. The system of record is a single database in one region. |
| **Case agent lifecycle under load** | The case agent's hibernation and wake-up (connections re-attached, scheduled expiries kept) cannot be forced in the local test runtime; it is reviewed, not tested. It also needs a test of SDK upgrades: the agent's hardening relies on the Agents SDK replacing `onMessage` in its constructor. |

## 2. Customer Identity

| Concern | Why it matters |
| --- | --- |
| **Several emails per person** | People have work and personal addresses and change them. One email per individual forces a choice and loses history. A profile with several verified emails is the usual production shape. |
| **Email verification** | An unverified email can belong to someone else. Lookups and contact authentication that trust it can be misled. |
| **Email normalization edge cases** | Provider-specific equivalences (dots and `+tags` in some providers' local parts) and internationalized addresses can make two strings the same mailbox, or make one mailbox look like two. Getting it wrong merges different people or splits one person. |
| **Invitations** | Joining an organization normally goes through an invitation (pending, accepted, expired, revoked), which is not modeled. |
| **Federation with the customer's identity provider** | Organizations expect their employees to be provisioned and deprovisioned from their own directory (SSO, SCIM). Deprovisioning that lags leaves former employees with access. |
| **Several organizations per individual, several accounts per customer** | The tables allow it; constraints forbid it. Lifting the constraints raises questions the model does not yet answer (which account is acting, defaults, switching). |
| **Dependents and guardians** | Minors and people who rely on someone else need a guardian with authority over their account and restricted rights of their own. Consent, the guardian relationship's lifecycle, and coming of age are not modeled. |
| **Organization hierarchy** | Subsidiaries and divisions often need shared administration or billing across organizations. |
| **Customer removal** | What removal means for the customer's accounts, memberships, subscriptions, open cases, and data, and whether it is reversible. |
| **Duplicate identities** | The same person registered twice (different emails) splits their history and access. Detection and merging are not addressed. |
| **Addresses, billing and legal contacts** | Required for invoicing, tax, and legal notices. |
| **Delivery to the exact address entered** | Only the normalized email is stored. A mail server that treats the local part as case-sensitive could reject the lowercased address. |

## 3. Internal Identity

| Concern | Why it matters |
| --- | --- |
| **Multi-factor authentication and passkeys** | A password alone is the weakest point of employee access, and employees can see every customer. |
| **Federation with a workforce identity provider** | Companies manage employees in one directory. Separate passwords drift from it, and access survives termination. |
| **Password policy and breached-password checks** | Weak or reused passwords are the most common way in. |
| **Lockout and rate limiting** | Without them, sign-in can be attacked by guessing. |
| **Joiner, mover, leaver lifecycle** | Employees are seeded. Hiring, changing jobs, and leaving must grant, adjust, and remove access on time. |
| **Access reviews** | Permissions accumulate. Periodic certification by managers is expected by auditors. |
| **Link between an employee and their own customer identity** | Without it, a conflict-of-interest rule (a CSR working on their own account) cannot be enforced. |
| **Employees across several products** | One internal account per identity. Several products would need one account per product scope. |
| **Workload credentials for system identities** | System identities run inside the application and hold no credentials. Processes running elsewhere would need their own verifiable identity. |
| **Bound session tokens** | The session token is a bearer token: whoever holds it acts. Binding it to the client (DPoP, mutual TLS) limits a stolen token. |
| **Session key rotation** | The ES256 signing key needs rotation with key ids (`kid`), and a known location for the private key. |
| **Sign-in hashing cost** | PBKDF2 at 100,000 iterations fits Workers' CPU limits; current guidance recommends 600,000. A memory-hard algorithm would be preferable where available. |

## 4. Access

| Concern | Why it matters |
| --- | --- |
| **Deny assignments** | Permissions can only be added. Removing one default permission from one person needs explicit deny assignments (an effect column, deny overriding grant). |
| **Resource-scoped roles** | Roles apply to a whole account. Large customers need roles on part of an account (a project, an environment). |
| **Delegated administration** | Assignments are seeded. Customers expect their own administrators to manage members and roles, within limits. |
| **Access certification** | Assignments accumulate. Periodic campaigns where owners confirm or remove access are expected by auditors. |
| **Separation of duties between roles** | Some role combinations should never be held together; no rule prevents it. |
| **Just-in-time elevation** | Sensitive permissions are held permanently. Granting them on request, for a short time, reduces standing access. |
| **OAuth delegation to client applications** | Only people act. Customers expect to delegate limited access to applications (scopes narrowing their own permissions). |

## 5. Product

| Concern | Why it matters |
| --- | --- |
| **Pricing, currencies, billing intervals** | The catalog has no prices. Selling needs prices per plan and add-on, per currency and interval. |
| **Plan versioning and grandfathering** | Changing a plan changes it for every subscriber at once. Existing customers usually keep the version they bought. |
| **Retiring plans and add-ons** | A plan withdrawn from sale must stay valid for its subscribers while refusing new ones. |
| **Usage metering** | Quotas are defined, but nothing counts consumption against them (beyond seats, which are counted from account role assignments). |
| **Quotas per period** | Quotas are totals. "Requests per day" needs a period and a reset. |
| **Regional availability** | Some features cannot be sold in some regions. |
| **Add-on removal on a plan change** | Removing an add-on in the middle of a paid term raises proration, refunds, timing (now or at the term's end), and customer notification. |
| **Accidental product mixing** | Plans may span products by design; nothing stops an unintended mix within a ladder. |

## 6. Entitlement

| Concern | Why it matters |
| --- | --- |
| **Billing integration** | Subscription terms are seeded. In production, billing adds `Payment` terms and cancels subscriptions; that interface needs its own identity, idempotency, and reconciliation. |
| **Grace periods** | How long an unpaid customer keeps access is billing's decision, expressed as the scheduled end of the last `Payment` term. |
| **Proration and credits** | Changing plans or adding add-ons in the middle of a paid term has a price effect. |
| **Scheduled changes** | Downgrades and cancellations often take effect at the end of the paid term, not immediately. The demo never creates future terms. |
| **Trial conversion and fallback** | A trial usually converts to a paid subscription automatically, adding a `Payment` term right after the `Trial` one; or it falls back to the ladder's `Free` plan. In the demo a trial's end leaves no covering term: nothing works, and the explanation says the trial ended. |
| **Courtesy and complimentary governance** | Free access must be capped, approved, and reported: how much is given away, by whom, and why. |
| **Usage metering beyond seats** | Quotas of other metered features need consumption counted against them. |

## 7. Support

| Concern | Why it matters |
| --- | --- |
| **Queues and routing** | Cases are assigned by hand. Volume needs queues, skills-based routing, and load balancing. |
| **Service levels** | Customers and contracts expect response and resolution times, measured and escalated. |
| **Contact authentication methods** | Knowledge checks are weak; one-time codes need a delivery channel; both need rate limits and lockout. |
| **Contact authentication freshness** | An authentication stays valid for the rest of the case (cleared only when the contact changes). Long cases need an expiry and re-authentication before sensitive changes. |
| **Workflow and database reconciliation** | Approval process instances and approval rows can diverge (an outbox row not delivered, an instance lost). A periodic reconciler must find `Pending` approvals without a live instance, and instances without a `Pending` approval, and repair them. |
| **Notifications beyond the application** | Approvers and CSRs are only told inside the application. Email or chat notifications need delivery, retries, and preferences. |
| **Conversation retention, export, and privacy** | Conversations contain personal data. How long they are kept, how they are exported, and how they are erased are unanswered. |
| **External ticketing systems** | Support organizations already run ticketing tools; cases would need to link to them. |
| **Approval escalation** | One supervisor seeds the demo, so a supervisor's own over-limit requests can never be approved; real teams need queues, escalation, and backup approvers. |
| **Insider enumeration** | Lookups by name or email reveal which accounts exist. Bulk-lookup detection and rate limits for employees are missing. |
| **LLM-written text stored as data** | Case summaries and conversations are untrusted text that may reach later prompts or screens. |

## 8. Account

| Concern | Why it matters |
| --- | --- |
| **Password hashing strength** | Workers' WebCrypto caps PBKDF2 at 100,000 iterations, below current guidance for PBKDF2-SHA256. Production would use Argon2id (WebAssembly, or a dedicated service) or delegate employee sign-in to the company's identity provider (OIDC with phishing-resistant MFA). |
| **Several accounts per identity** | Accounts are limited to one per identity. Several accounts need declaring the account at sign-in, a default-account preference, and switching (a new token, with step-up where the target account requires it). |
| **Workload credentials for system accounts** | System accounts act inside the application. Processes running elsewhere need verifiable credentials. Deployments are recorded as `sys_deployment`, but are authenticated only by the database owner's credentials; production runs them from CI with a workload identity (for example, a signed OIDC token exchanged for a short-lived credential) that maps to `sys_deployment`. |
| **Ending sessions** | Sessions end only by expiry or sign-out clearing the cookie. Revoking a session (a lost laptop, a terminated employee) before expiry needs a revocation list by `sid` checked per request; today the principal re-check catches suspensions and inactive identities, not a stolen token of an active employee. |
| **`OrganizationMember` accounts after leaving** | The category is immutable and each customer has one account, so an individual who leaves an organization cannot subscribe personally until several accounts per customer are allowed. |

## 9. Attribution

| Concern | Why it matters |
| --- | --- |
| **Audit checkpoints** | A keyed chain resists recomputation only while the key is safe. Publishing checkpoints (record, hash, time) where database writers cannot reach makes any rewrite detectable. |
| **Signatures** | HMAC verification needs the key. Signing checkpoints (Ed25519) lets external auditors verify with a public key. |
| **Keys in a hardware security module** | Worker secrets are distributed by the platform. A key that never leaves a hardware module cannot be copied at all. |
| **Asynchronous chaining** | A single synchronous chain serializes audit writes. Chaining after commit, in order, removes the wait from business transactions. |
| **Partitioned chains and a Merkle tree** | Several regions cannot share one chain head. Chains per partition, combined periodically into one Merkle root, scale across regions. |
| **Retention and legal holds** | How long audit records are kept, and how records under investigation are protected from expiry. |
| **Security event management** | Security event logs (failed sign-ins, rejected requests) need collection, correlation, and alerting (brute force, denial bursts). |
| **Database-level auditing** | Operators, migrations, and seeding bypass the application and its audit. |
| **Audit cost on the read path** | Every read writes an audit record under the global chain-head lock. Under load, this limits throughput; asynchronous chaining or batching read records would be needed. |
| **Head lock across round trips** | The lock is taken as the last statement before commit. Through Hyperdrive each statement is a network round trip, so the lock is still held for several of them; one stored procedure for the whole audit write would shorten it. |
| **Migration ordering** | Each subsystem owns its migrations; foreign keys across subsystems need one global order. Seeding bypasses use cases and their audit. |

## 10. Policy

| Concern | Why it matters |
| --- | --- |
| **Authoring and review workflow** | Policies change authorization for everyone. Who may propose, review, and approve a change must be defined. |
| **Shadow evaluation** | A new set should be evaluated alongside the active one, comparing decisions, before it is activated. |
| **Policy analytics** | Which policies fire, how often, and for whom, to find dead or overly broad policies. |
| **Another evaluator** | Replacing the evaluator (for example with Cedar) behind the same port, with the case files as the conformance suite. |
