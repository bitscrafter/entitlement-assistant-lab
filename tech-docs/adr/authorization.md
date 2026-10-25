# Authorization — Architecture Decisions

|  |  |
| :--- | :--- |
| **Purpose** | The authorization decision: whether an account may perform an action in an account context. A subsystem with no tables; it combines Account, Access, Entitlement, and Policy. |
| **References** | • Policies: [`../data-model/policy.md`](../data-model/policy.md)<br>• Access: [`../data-model/access.md`](../data-model/access.md)<br>• Entitlement: [`../data-model/entitlement.md`](../data-model/entitlement.md)<br>• Index and template: [`README.md`](README.md) |

---

## Contents

| Number | Name |
| :--- | :--- |
| [AU-1](#au-1-the-decision-is-a-chain-of-responsibility) | The decision is a chain of responsibility |
| [AU-2](#au-2-findings-and-decisions) | Findings and decisions |
| [AU-3](#au-3-default-deny-lives-in-the-access-step) | Default deny lives in the access step |
| [AU-4](#au-4-every-use-case-touching-a-subject-passes-the-accountread-gate) | Every use case touching a subject passes the account.read gate |
| [AU-5](#au-5-the-pdp-and-pip-live-in-authorization-peps-are-use-cases) | The PDP and PIP live in Authorization; PEPs are use cases |
| [AU-6](#au-6-refusals-reveal-nothing-beyond-what-a-legitimate-principal-may-know) | Refusals reveal nothing beyond what a legitimate principal may know |

---


## Decisions

### AU-1. The decision is a chain of responsibility

| | |
| :--- | :--- |
| **Decision** | One building block, the Policy Decision Point, runs handlers in a fixed order:<br>• account: neither the actor's nor the subject's account is suspended (AC-6)<br>• access: the actor holds the permission<br>• contact access: a contact, if any, holds the customer permission in the subject account (SU-8)<br>• entitlement: for feature actions, the subject account is entitled<br>• policy: every applicable policy<br>Each handler adds findings and passes on; the chain stops early only where nothing further matters (a suspended account). |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Rationale** | • Independent, replaceable handlers (Chain of Responsibility, GoF).<br>• Every reason is reported, not only the first. |
| **Alternatives** | Classic chain stopping at the first refusal: explanations would show one reason. |
| **Amendments** | 2026-10-24 — the subject's suspension stops feature actions and changes, not employee reads (`account.read`, `audit.read`); see AC-6.<br>2026-10-25 — wording: a pipeline of handlers, a Chain of Responsibility variant in which every handler runs (classic CoR stops at the first handler that acts).<br>2026-10-25 — the account step also checks the contact's account; terminating actions (end, expire, cancel, record) are not stopped by the subject's suspension. |

---

### AU-2. Findings and decisions

| | |
| :--- | :--- |
| **Decision** | Handlers produce findings; the decision combines them:<br>• Finding: `source` (account, access, entitlement, policy), `reasonCode`, `outcome` (`Allow`, `Deny`, `Conditional`), `obligations`, `facts`<br>• Decision: the most restrictive outcome, all findings, all obligations, the policy set version |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Rationale** | `Allow` findings explain why something is allowed (which role granted it); `facts` are what explanations cite. |
| **Related** | [AT-5](attribution.md#at-5-action-keys-outcomes-and-reasons) |
| **Amendments** | 2026-10-25 — obligations are prerequisites (PO-3); sources are account, access, contact-access, entitlement, policy. |

---

### AU-3. Default deny lives in the access step

| | |
| :--- | :--- |
| **Decision** | The access handler denies unless a role or assignment explicitly grants the permission:<br>• nothing is allowed by omission<br>• policies can only add `Deny` or `Conditional` on top |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Rationale** | Allow-listing first, extra requirements second: defense in depth. |
| **Related** | • [AC-1](access.md#ac-1-rbac-grants-policies-constrain)<br>• [PO-1](policy.md#po-1-policies-are-requirements-in-positive-form) |

---

### AU-4. Every use case touching a subject passes the account.read gate

|  |  |
| :--- | :--- |
| **Decision** | Before its own action, every use case that touches a subject account asks for `account.read` on it:<br>• history (`audit.read`), changes, and explanations included<br>• policies on reading (for example, Enterprise accounts) then apply everywhere, stated once |
| **Status** | Accepted · 2026-10-25 · decided by the owner |
| **Context** | An Enterprise read policy governing only `account.read` was bypassed through history and changes. |
| **Related** | [AU-1](#au-1-the-decision-is-a-chain-of-responsibility) |
| **Amendments** | 2026-10-25 — the gate applies to employee-initiated use cases; system actions are authorized by their own permission. The gate is one finding within the action's decision, not a separate decision (AT-3). |

---

### AU-5. The PDP and PIP live in Authorization; PEPs are use cases

|  |  |
| :--- | :--- |
| **Decision** | The roles of the standard authorization architecture:<br>• PEP (enforcement): each use case, at the boundary of what it protects; one shared template (authorize, execute, audit)<br>• PDP (decision) and PIP (attributes: principal and resource): Authorization; the use case passes a typed context<br>• PAP (administration): policy files and their registration and activation (Policy)<br>• PRP (retrieval): the policy set bundled into the Worker (Policy) |
| **Status** | Accepted · 2026-10-25 · decided by the owner |
| **Rationale** | • Policy stays a pure evaluator, with no dependency on Support.<br>• Enforcement is specific to each use case; the template keeps it from being skipped. |
| **Related** | [CM-15](common.md#cm-15-foreign-keys-point-down-the-layer-order) |
| **Amendments** | 2026-10-25 — Authorization owns the typed context contract per action; each PEP fills it from its own data (for example, Support supplies `approval_granted`, `actor_is_assignee`). |

---

### AU-6. Refusals reveal nothing beyond what a legitimate principal may know

|  |  |
| :--- | :--- |
| **Decision** | What a refusal discloses depends on who asks:<br>• unauthenticated requests never reach a decision (`401`)<br>• an authenticated principal that holds the base permission (`account.read`) but is stopped by a policy gets `Denied` with the policy's reason codes: a legitimate CSR who needs to escalate<br>• any other principal gets `NotFound`, indistinguishable from an account that does not exist<br>• in a lookup, denied candidates are omitted; when every candidate is denied, the principal gets `Denied` only under the rule above, otherwise `NotFound` |
| **Status** | Accepted · 2026-10-25 · decided by the owner |
| **Context** | A `Denied` answer confirms that something exists. |
| **Rationale** | Existence is disclosed only to a proven, legitimate principal with a reason to know it. |
| **Related** | • [AU-4](#au-4-every-use-case-touching-a-subject-passes-the-accountread-gate)<br>• [AN-5](account.md#an-5-a-session-acts-as-one-declared-account) |
| **Alternatives** | • Always `Denied`: confirms existence to anyone.<br>• Always `NotFound`: a legitimate CSR cannot tell an escalation case from a typo. |
