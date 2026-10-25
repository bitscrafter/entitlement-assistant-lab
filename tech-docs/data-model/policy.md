# Policy — Data Model

|  |  |
| :--- | :--- |
| **Purpose** | Policies add requirements on top of what roles allow. They are authored as files, bundled into the application at build time, and recorded in the database as immutable, versioned sets. |
| **Status** | Ruled by the owner (2026-10-24; coverage, cancellation, and quota limits 2026-10-25) |
| **References** | • Diagram: [`../diagrams/policy.er.puml`](../diagrams/policy.er.puml) (rendered: [`../diagrams/policy.svg`](../diagrams/policy.svg))<br>• Decisions: [`../adr/policy.md`](../adr/policy.md); the decision chain that uses policies: [`../adr/authorization.md`](../adr/authorization.md)<br>• Index: [`README.md`](README.md) |

## Contents

1. [Concepts](#1-concepts)
2. [A policy](#2-a-policy)
3. [Combining policies](#3-combining-policies)
4. [Attributes](#4-attributes)
5. [The starting policy set](#5-the-starting-policy-set)
6. [Files, database, and Workers](#6-files-database-and-workers)
7. [Testing](#7-testing)
8. [Invariants](#8-invariants)
9. [Not addressed](#9-not-addressed)

---

## 1. Concepts

| Term | Meaning |
| --- | --- |
| **Policy** | A requirement in positive form on one or more actions: when it applies, something must hold; when it does not hold, its **unmet outcome** applies. Policies never allow anything: roles do (AC-1). |
| **Governed action** | An action a policy applies to. |
| **Applies-when predicate** | When the policy applies (default `true`). |
| **Optional attribute** | An attribute that may have no value (an unlimited quota, an account that never had a term); predicates test it with `has()`. |
| **Requires predicate** | What must hold for the action to proceed unconditionally. |
| **Unmet outcome** | `Deny`, or `Conditional`: the action may proceed once its **prerequisites** are fulfilled. |
| **Prerequisite** | Something that must happen before the action proceeds: `Approval` (by an account holding a given permission). Fulfilling it changes an attribute, so the same predicate holds on re-evaluation. |
| **Policy set** | All policies evaluated together, versioned by the hash of their content. |
| **Policy set version** | SHA-256 of the set's canonical JSON (RFC 8785), shown as unpadded base64url (CM-14). |
| **Policy set activation** | The span during which a set is in force. |

## 2. A policy

Authored in YAML (block style) under `application/entitlement-agent/resource/policies/`:

```yaml
policy_key: grants-up-to-14-days
description: Grants longer than 14 days need a supervisor's approval.
governed_actions:
  - grant.create
applies_when: "true"
requires: context.duration_days <= 14 || context.approval_granted
unmet_outcome: Conditional
prerequisites:
  - prerequisite_kind: Approval
    fulfilled_by_permission: approval.decide
```

The reason code of an unmet policy is `policy.<policy_key>`; `description` is the explanation shown to the CSR.

## 3. Combining policies

Every policy that governs the action and applies is evaluated; all unmet policies are reported:

| Unmet policies | Policy finding |
| --- | --- |
| any with `Deny` | `Deny` |
| otherwise, any with `Conditional` | `Conditional`, with all their prerequisites |
| none | `Allow` (the role already allowed the action) |

**Prerequisites are fulfilled through attributes.** When a change needing approval is approved, the
Policy Information Point loads `context.approval_granted` from the `Approved` approval; re-evaluation at
apply time (SU-15) then finds the requirement met. Nothing sets it from a request or from model text.

## 4. Attributes

A closed, typed schema. Expressions may use only these; the Policy Information Point (PIP, in Authorization: AU-5) is their only
source, loading them from trusted data, never from the language model's text.

| Namespace | Attributes | Loaded from |
| --- | --- | --- |
| `principal` | `account_id`, `account_kind`, `identity_kind`, `department`, `job_function`, `job_level` | the session's account and its identity |
| `resource` | `account_id`, `account_category`, `plan_key`, `plan_ladder_key`, `tier_rank`, `seats_in_use` | the subject account: Account, Entitlement |
| `context` | `action_key`, `duration_days`, `coverage_source`, `target_plan_key`, `target_seat_quota`, `target_tier_rank`, `feature_key`, `quota`, `has_contact`, `contact_authenticated`, `requester_account_id`, `confirmer_account_id`, `actor_is_assignee`, `approval_granted` | the validated change request, the case, the approval |
| `environment` | `now` | the `Clock` port |

Attribute meanings that matter for safety:

| Attribute | Meaning |
| --- | --- |
| `resource.plan_key` | The plan of the account's **latest** term, current or ended. Stable on purpose: an Enterprise account whose coverage lapsed is still protected by Enterprise rules. Absent only when the account never had a term. |
| `context.target_seat_quota` | The **effective** seat quota after the change (target plan bundle plus add-ons plus active grants), absent when unlimited. |
| `context.coverage_source`, `context.duration_days` | The coverage a plan change adds (`Trial`, `Courtesy`) and its length; for `subscription.add-courtesy-term`, `Courtesy` and its length. |
| `context.quota` | A grant's quota; absent for an unmetered feature. |
| `context.actor_is_assignee` | Supplied by Support's PEP; used by Support's assignee finding (SU-14), not by a policy. |
| `context.approval_granted` | True only when an `Approved` approval exists for this change request. |

## 5. The starting policy set

| `policy_key` | Governs | Applies when | Requires | If unmet |
| --- | --- | --- | --- | --- |
| `enterprise-accounts-need-level-2` | `account.read` | `has(resource.plan_key) && resource.plan_key == 'enterprise'` | `principal.job_level >= 2 \|\| principal.job_function == 'supervisor'` | Deny |
| `grants-up-to-14-days` | `grant.create` | always | `context.duration_days <= 14 \|\| context.approval_granted` | Conditional: Approval |
| `grants-up-to-90-days` | `grant.create` | always | `context.duration_days <= 90` | Deny |
| `courtesy-up-to-14-days` | `subscription.add-courtesy-term`, `subscription.change-plan` | `context.coverage_source == 'Courtesy'` | `context.duration_days <= 14` | Deny |
| `trial-coverage-up-to-14-days` | `subscription.change-plan` | `context.coverage_source == 'Trial'` | `context.duration_days <= 14` | Deny |
| `grant-quota-up-to-100` | `grant.create` | `has(context.quota)` | `context.quota <= 100` | Deny |
| `downgrade-fits-seats` | `subscription.change-plan` | `has(context.target_seat_quota)` (an unlimited target always fits) | `resource.seats_in_use <= context.target_seat_quota` | Deny |
| `upgrade-beyond-pro-needs-contact-or-approval` | `subscription.change-plan` | `context.target_tier_rank > 2 && !context.has_contact` | `context.approval_granted` | Conditional: Approval |
| `cancel-needs-contact-or-approval` | `subscription.cancel` | `!context.has_contact` | `context.approval_granted` | Conditional: Approval |
| `contact-is-authenticated` | `subscription.change-plan`, `subscription.cancel`, `grant.create` | `context.has_contact` | `context.contact_authenticated` | Deny |
| `no-self-approval` | `approval.decide` | always | `principal.account_id != context.requester_account_id && principal.account_id != context.confirmer_account_id` | Deny |

## 6. Files, database, and Workers

| Concern | Rule |
| --- | --- |
| Source of truth | The YAML files, under version control. |
| At build | The set is validated (structure; expression types against the attribute schema with CEL's type checker; known action keys and prerequisite kinds), hashed, and bundled into the Worker. |
| At deployment | The set is registered: inserted once into `policy_set`, `policy`, `policy_governed_action`, `policy_prerequisite` (unchanged forever), then activated. |
| Rollout | Activate the new set (two active), roll out the Worker, end the old activation. |
| In each Worker | Decides only when its bundled set's version is active. It checks at startup and again lazily, at most once a minute, when a decision is requested. If the check fails or cannot run, it refuses decisions (fail closed). |
| Evidence | Each audit record references the set that decided (`audit_chain_record.policy_set_version`). |

## 7. Testing

Policy cases are **data, kept apart from test code**: one
`typescript/system/application/entitlement-agent/tests/functional/policy/cases/<policy_key>.cases.yaml` per policy, each case in
Given/When/Then form with `then: true` (satisfied, or not applicable) or `then: false` (unmet). One suite
runs every case against the real set and evaluator. Every policy has a case file, and a verification test
fails when one is missing. The policy subsystem keeps its own unit tests on synthetic policies (PO-6).

## 8. Invariants

| Invariant | Guard |
| --- | --- |
| Policy sets and their policies never change once loaded. | database role privileges: `INSERT` and `SELECT` only (CM-13) |
| A set's version is the hash of its content. | loader computes it; verification test recomputes it from stored rows |
| Expressions use only declared attributes, with matching types. | type check at build |
| At most two active sets, two only during a rollout. | activation use case; verification test |
| A Worker never decides with an inactive set. | startup and lazy re-check; fail closed |

## 9. Not addressed

Listed in [`../production-readiness.md`](../production-readiness.md): the policy authoring and review
workflow, shadow evaluation before activation, policy analytics, and replacing the evaluator (Cedar)
behind the same port.
