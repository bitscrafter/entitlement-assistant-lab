# Policy — Architecture Decisions

|  |  |
| :--- | :--- |
| **Purpose** | Requirements on top of what roles allow: their shape, language, storage, and testing. |
| **References** | • Model: [`../data-model/policy.md`](../data-model/policy.md)<br>• Diagram: [`../diagrams/policy.svg`](../diagrams/policy.svg)<br>• Index and template: [`README.md`](README.md) |

---

## Contents

| Number | Name |
| :--- | :--- |
| [PO-1](#po-1-policies-are-requirements-in-positive-form) | Policies are requirements in positive form |
| [PO-2](#po-2-deny-wins-then-conditional) | Deny wins, then Conditional |
| [PO-3](#po-3-prerequisites-are-fulfilled-through-attributes) | Prerequisites are fulfilled through attributes |
| [PO-4](#po-4-cel-predicates-over-a-closed-attribute-schema) | CEL predicates over a closed attribute schema |
| [PO-5](#po-5-files-are-the-source-loaded-sets-are-immutable) | Files are the source; loaded sets are immutable |
| [PO-6](#po-6-policy-cases-are-data-outside-the-policy-files) | Policy cases are data, outside the policy files |

---


## Decisions

### PO-1. Policies are requirements in positive form

| | |
| :--- | :--- |
| **Decision** | A policy states what must hold, on the actions it governs:<br>• `governed_actions`<br>• `applies_when`: when it applies (default `true`)<br>• `requires`: what must hold<br>• `unmet_outcome`: `Deny`, or `Conditional` with `obligations`<br>• `description`: the explanation shown to the CSR |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Context** | Roles grant (AC-1); policies only add requirements. |
| **Rationale** | • Readability: "must be at most 14 days" instead of "forbid when more than 14".<br>• Default deny stays where it belongs: no role, no permission. |
| **Examples** | `grants-up-to-90-days`: governs `grant.create`, requires `context.duration_days <= 90`, unmet: `Deny`. |
| **Related** | [AC-1](access.md#ac-1-rbac-grants-policies-constrain) |
| **Alternatives** | • Permit and forbid effects: duplicates what roles already grant.<br>• Negative conditions (`forbid when …`): harder to read. |
| **Amendments** | 2026-10-25 — obligations are prerequisites (PO-3). |

---

### PO-2. Deny wins, then Conditional

| | |
| :--- | :--- |
| **Decision** | All applicable policies are evaluated, and every unmet one is reported:<br>• any unmet `Deny` → `Deny`<br>• otherwise any unmet `Conditional` → `Conditional`, with all obligations<br>• otherwise `Allow` |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Rationale** | The most restrictive outcome wins; explanations list every reason (AU-1). |
| **Amendments** | 2026-10-25 — obligations are prerequisites (PO-3). |

---

### PO-3. Prerequisites are fulfilled through attributes

| | |
| :--- | :--- |
| **Decision** | A `Conditional` outcome names obligations, and fulfilling one makes the requirement hold:<br>• `obligation_kind`: `Approval` (closed set; extended when needed)<br>• `fulfilled_by_permission`: who can fulfill it<br>• the predicate includes the fulfillment: "or `context.approval_granted`"; re-evaluation at apply time finds it met |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Context** | Approval is one kind of "proceed once something happens"; step-up authentication or customer consent are others. |
| **Rationale** | No special case in the engine: an obligation is fulfilled, an attribute changes, the same predicate passes. |
| **Consequences** | The audit outcome `RequiresApproval` becomes `Conditional` (AT-5, amended). |
| **Related** | [AT-5](attribution.md#at-5-action-keys-outcomes-and-reasons) |
| **Alternatives** | A `RequiresApproval` outcome: one hard-coded kind of condition. |
| **Amendments** | 2026-10-25 — *obligations* are renamed *prerequisites* (`prerequisite_kind`, `policy_prerequisite`): in XACML, obligations are duties performed with a decision; ours must be fulfilled before the action proceeds. |

---

### PO-4. CEL predicates over a closed attribute schema

| | |
| :--- | :--- |
| **Decision** | Predicates are CEL (Common Expression Language) expressions:<br>• over a closed, typed schema: `principal`, `resource`, `context`, `environment`<br>• type-checked at build: unknown attributes and mismatched types fail<br>• attributes come only from the Policy Information Point, never from the language model<br>• a spike confirms a CEL library in Workers; the fallback is our own parser for the same syntax subset |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Rationale** | • Readable predicates.<br>• CEL is side-effect free, always terminates, and is used by Google Cloud IAM and Kubernetes.<br>• Typos fail at build, not silently at runtime. |
| **Alternatives** | • Structured YAML trees: unreadable.<br>• JavaScript evaluation: unsafe, and blocked in Workers. |
| **Amendments** | 2026-10-25 — attributes may be optional: a predicate tests presence with `has()` (an unlimited quota or an account without a plan has no value). |

---

### PO-5. Files are the source; loaded sets are immutable

| | |
| :--- | :--- |
| **Decision** | Policies live in files and are recorded in the database:<br>• YAML under `application/entitlement-assistant/resource/policies/`, bundled into the Worker at build<br>• each deployed set inserted once into the database, never changed (insert-only privileges)<br>• `policy_set_version` = keyless SHA-256 of the canonical set, unpadded base64url<br>• `policy_set_activation` records which set is in force; two only during a rollout<br>• a Worker decides only while its bundled set is active: checked at startup and lazily, at most once a minute; fail closed |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Rationale** | • Speed: no database read per decision.<br>• Evidence: auditors read the exact text that decided, through the audit record.<br>• Reproducible versions: anyone can hash the file and match it. |
| **Consequences** | Changing policy means deploying. |
| **Related** | • [CM-7](common.md#cm-7-never-delete-identities-or-history)<br>• [CM-14](common.md#cm-14-uuidv7-ids-stored-natively-shown-with-a-prefix) |
| **Alternatives** | • Read policies from the database per decision: slow in short-lived isolates.<br>• An HMAC version: not reproducible by auditors.<br>• Push notifications to Workers: isolates cannot receive them; deployments retire old isolates anyway. |
| **Amendments** | 2026-10-25 — wording: anyone can canonicalize the set (RFC 8785) and hash it to reproduce the version. |

---

### PO-6. Policy cases are data, outside the policy files

| | |
| :--- | :--- |
| **Decision** | Each policy has a case file of Given/When/Then cases:<br>• `then: true` (satisfied or not applicable) or `then: false` (unmet)<br>• kept apart from test code; one functional suite runs every case<br>• the build type-checks the set; policy files hold no examples |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Rationale** | Policy files stay declarative; cases serve as the examples and cannot rot, because they run. |
| **Amendments** | 2026-10-25 — case files live with the policies' application: `application/entitlement-assistant/tests/functional/policy/cases/`; the policy subsystem keeps evaluator unit tests on synthetic policies. |
