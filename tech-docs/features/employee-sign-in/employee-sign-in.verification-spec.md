# Employee Sign-In — Verification Spec

| | |
| :--- | :--- |
| **Purpose** | States what the feature must do: an employee signs in, the session acts as their internal account, invalid tokens and invalid principals are rejected, and sessions renew up to an absolute lifetime. Each scenario becomes exactly one verification test (`AI_AS_TESTER.md`). |
| **Status** | Draft — for owner approval |
| **Feature** | employee-sign-in · scenarios S01–S03, S04a–S04f |
| **Mode** | feature, no customer data |
| **Depends on** | — (the first feature) |
| **References** | • Proposal: [`../../entitlement-agent-proposal.md`](../../entitlement-agent-proposal.md) §7<br>• Sessions: CM-3, CM-16, AN-5 in [`../../adr/`](../../adr/README.md); disclosure: AU-6<br>• Internal identities and accounts: [`../../data-model/internal-identity.md`](../../data-model/internal-identity.md), [`../../data-model/account.md`](../../data-model/account.md) §4<br>• Audit and reason codes: [`../../data-model/attribution.md`](../../data-model/attribution.md) §4a<br>• Sequence: [`../../diagrams/sign-in.sequence.puml`](../../diagrams/sign-in.sequence.puml) |

## Contents

1. [Decisions this spec relies on](#1-decisions-this-spec-relies-on)
2. [Fixture](#2-fixture)
3. [Interfaces under test](#3-interfaces-under-test)
4. [Scenarios](#4-scenarios)
   - [S01 — An employee signs in; the session acts as their internal account](#s01--an-employee-signs-in-the-session-acts-as-their-internal-account)
   - [S02 — Sign-in is rejected without revealing which part was wrong](#s02--sign-in-is-rejected-without-revealing-which-part-was-wrong)
   - [S03 — A request without a valid token, or for an invalid principal, is rejected](#s03--a-request-without-a-valid-token-or-for-an-invalid-principal-is-rejected)
   - [S04a — Renewal before half-life changes nothing](#s04a--renewal-before-half-life-changes-nothing)
   - [S04b — Renewal past half-life re-issues the token in the same session](#s04b--renewal-past-half-life-re-issues-the-token-in-the-same-session)
   - [S04c — Renewal is capped by the absolute lifetime](#s04c--renewal-is-capped-by-the-absolute-lifetime)
   - [S04d — Renewal is refused once the token ends at the absolute lifetime](#s04d--renewal-is-refused-once-the-token-ends-at-the-absolute-lifetime)
   - [S04e — An expired token cannot be renewed](#s04e--an-expired-token-cannot-be-renewed)
   - [S04f — Renewal re-checks the principal](#s04f--renewal-re-checks-the-principal)
5. [Not in this feature](#5-not-in-this-feature)

---

## 1. Decisions this spec relies on

Approving this spec also approves these values:

| # | Decision | Reason |
| --- | --- | --- |
| D1 | **Session token:** JWT, ES256, issuer and audience `entitlement-agent`. Claims `sub` (the internal account), `sid`, `auth_time`, `iat`, `exp`, `jti`; no roles (CM-16). Lifetime 30 minutes. | Stateless sessions; the principal is loaded fresh per request. |
| D2 | **Renewal:** `POST /api/authentication/session/renewal`. Before half the token's lifetime it does nothing. Past half-life it re-checks the principal and re-issues the token with the same `sid` and `auth_time`, a new `jti`, and `exp` = min(`iat` + 30 min, `auth_time` + 8 h). When the token already ends at `auth_time` + 8 h, renewal is refused. | A short-lived token kept alive by activity, never beyond the absolute lifetime. |
| D3 | **Every sign-in failure looks the same to the caller:** wrong password, unknown email, empty password, inactive identity, suspended account. Only the audit record, which the caller never sees, tells them apart. | No account enumeration before authentication (AU-6). |
| D4 | **A valid token is not enough:** every request re-loads the principal; an inactive identity or a suspended account gets `401`, like an invalid token. | The principal is loaded fresh (CM-16). |
| D5 | **The fixed instant of every test is `2026-10-22T15:00:00Z`** unless a scenario says otherwise. | Token times must not depend on when the tests run. |
| D6 | **Fixture ids are readable aliases** (`emp_alex`, `iac_alex`) for seeded UUIDv7 values (CM-14). The host is `app.entitlement-agent.example`. | Readable scenarios. |
| D7 | **The session cookie is `__Host-session`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, no `Domain`, `Max-Age` equal to the token's remaining lifetime.** Every response carries `Strict-Transport-Security: max-age=31536000; includeSubDomains`; plain HTTP is redirected to HTTPS at Cloudflare's edge (zone setting) before the Worker runs. | Scripts cannot read the token; it never travels over HTTP or to another site or host. |

## 2. Fixture

```yaml
internal_identities:
  - identity: emp_alex
    kind: Employee
    status: Active
    email: alex@provider.example
    display_name: Alex
    department: customer-support
    job_function: representative
    job_level: 1
    password: alex-demo-password          # stored as a PBKDF2 PHC string
    internal_account:
      account: iac_alex
      status: Active                       # no holds
    birthright_roles:
      - support-case-handling
  - identity: emp_blair
    kind: Employee
    status: Active
    email: blair@provider.example
    display_name: Blair
    department: customer-support
    job_function: representative
    job_level: 2
    password: blair-demo-password
    internal_account:
      account: iac_blair
      status: Active
    birthright_roles:
      - support-case-handling
      - subscription-cancellation
  - identity: emp_casey
    kind: Employee
    status: Suspended
    email: casey@provider.example
    display_name: Casey
    department: customer-support
    job_function: representative
    job_level: 1
    password: casey-demo-password
    internal_account:
      account: iac_casey
      status: Suspended
      holds:
        - InternalIdentityInactive
  - identity: emp_dana
    kind: Employee
    status: Active
    email: dana@provider.example
    display_name: Dana
    department: customer-support
    job_function: representative
    job_level: 1
    password: dana-demo-password
    internal_account:
      account: iac_dana
      status: Suspended
      holds:
        - OperationalSuspension            # placed 2026-10-22T14:55:00Z
    birthright_roles:
      - support-case-handling
session_signing_key: the server's ES256 key pair
```

## 3. Interfaces under test

```text
POST /api/authentication/sign-in             body { email, password, account_id? }
                                             → 204 + session cookie | 401 invalid_credentials
POST /api/authentication/session/renewal     session cookie
                                             → 204 (+ renewed cookie past half-life) | 403 absolute_lifetime_reached
                                               | 401 invalid_session
GET  /api/authentication/session             session cookie
                                             → 200 { account_id, display_name, department, job_function,
                                                     job_level, roles } | 401 invalid_session
session cookie                               __Host-session=<JWT>; HttpOnly; Secure; SameSite=Strict; Path=/
error bodies                                 OAuth 2 format, top level only (api.md §3): error, error_description
JSON bodies                                  shown formatted for reading; Content-Length is the length of the
                                             compact form the server sends
```

---

## 4. Scenarios

### S01 — An employee signs in; the session acts as their internal account

**Level:** `[http]`

**Given:**

```text
emp_alex is Active, with email alex@provider.example and password alex-demo-password.
emp_alex is in customer-support, a representative, job level 1, display name Alex.
Its internal account iac_alex is Active, with no holds.
Its birthright role is support-case-handling.
The instant is 2026-10-22T15:00:00Z.
```

**When:**

```http
POST /api/authentication/sign-in HTTP/1.1
Host: app.entitlement-agent.example
Origin: https://app.entitlement-agent.example
Content-Type: application/json
Content-Length: 65

{
  "email": "alex@provider.example",
  "password": "alex-demo-password"
}
```

**Then:**

```http
HTTP/1.1 204 No Content
Strict-Transport-Security: max-age=31536000; includeSubDomains
Set-Cookie: __Host-session=<token>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=1800
```

```yaml
session_cookie:
  name: __Host-session                    # the prefix: the browser rejects it unless Secure, Path=/, no Domain
  http_only: true                         # page scripts cannot read it
  secure: true                            # sent only over HTTPS
  same_site: Strict                       # never sent on cross-site requests
  path: /                                 # required by the prefix; the agent WebSocket under /agents needs it
  domain: absent                          # bound to this exact host
  max_age: 1800                            # the token's remaining lifetime
token:
  header:
    alg: ES256
  claims:
    iss: entitlement-agent
    aud: entitlement-agent
    sub: iac_alex
    sid: present
    iat: "2026-10-22T15:00:00Z"
    auth_time: "2026-10-22T15:00:00Z"     # equals iat
    exp: "2026-10-22T15:30:00Z"           # iat + 30 min
    jti: present
    roles: absent
audit_records:                            # exactly one
  - action_key: session.sign-in
    actor: iac_alex
    audit_outcome: Succeeded
    session_id: the token's sid
```

**And then**, the session reads the principal:

```http
GET /api/authentication/session HTTP/1.1
Host: app.entitlement-agent.example
Cookie: __Host-session=<token>
```

```http
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 159

{
  "account_id": "iac_alex",
  "display_name": "Alex",
  "department": "customer-support",
  "job_function": "representative",
  "job_level": 1,
  "roles": [
    "support-case-handling"
  ]
}
```

### S02 — Sign-in is rejected without revealing which part was wrong

**Level:** `[http]` · every case expects the same response; only the audit record differs.

**Given** (all cases):

```text
emp_alex is Active, with email alex@provider.example and password alex-demo-password; iac_alex has no holds.
No identity has the email nobody@provider.example.
emp_casey is Suspended (password casey-demo-password); iac_casey is Suspended (hold InternalIdentityInactive).
emp_dana is Active (password dana-demo-password); iac_dana is Suspended (hold OperationalSuspension).
The instant is 2026-10-22T15:00:00Z.
```

**Case A — Wrong password**

When:

```http
POST /api/authentication/sign-in HTTP/1.1
Host: app.entitlement-agent.example
Origin: https://app.entitlement-agent.example
Content-Type: application/json
Content-Length: 61

{
  "email": "alex@provider.example",
  "password": "wrong-password"
}
```

Then:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Content-Length: 89

{
  "error": "invalid_credentials",
  "error_description": "The email or password is incorrect."
}
```

```yaml
set_cookie: absent
response: byte-identical to every other case of S02
audit_records:                            # exactly one
  - action_key: session.sign-in
    actor: absent
    audit_outcome: Failed
    reasons:
      - session.invalid-credentials
    detail:
      attempted_identifier_hmac: present
      email: absent                       # the email appears nowhere in the record
```

**Case B — Unknown email**

When:

```http
POST /api/authentication/sign-in HTTP/1.1
Host: app.entitlement-agent.example
Origin: https://app.entitlement-agent.example
Content-Type: application/json
Content-Length: 67

{
  "email": "nobody@provider.example",
  "password": "alex-demo-password"
}
```

Then:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Content-Length: 89

{
  "error": "invalid_credentials",
  "error_description": "The email or password is incorrect."
}
```

```yaml
set_cookie: absent
response: byte-identical to every other case of S02
audit_records:                            # exactly one
  - action_key: session.sign-in
    actor: absent
    audit_outcome: Failed
    reasons:
      - session.invalid-credentials
    detail:
      attempted_identifier_hmac: present
      email: absent                       # the email appears nowhere in the record
```

**Case C — Empty password**

When:

```http
POST /api/authentication/sign-in HTTP/1.1
Host: app.entitlement-agent.example
Origin: https://app.entitlement-agent.example
Content-Type: application/json
Content-Length: 47

{
  "email": "alex@provider.example",
  "password": ""
}
```

Then:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Content-Length: 89

{
  "error": "invalid_credentials",
  "error_description": "The email or password is incorrect."
}
```

```yaml
set_cookie: absent
response: byte-identical to every other case of S02
audit_records:                            # exactly one
  - action_key: session.sign-in
    actor: absent
    audit_outcome: Failed
    reasons:
      - session.invalid-credentials
    detail:
      attempted_identifier_hmac: present
      email: absent                       # the email appears nowhere in the record
```

```text
The empty password goes through the same credential verification.
```

**Case D — Inactive identity, correct password**

When:

```http
POST /api/authentication/sign-in HTTP/1.1
Host: app.entitlement-agent.example
Origin: https://app.entitlement-agent.example
Content-Type: application/json
Content-Length: 67

{
  "email": "casey@provider.example",
  "password": "casey-demo-password"
}
```

Then:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Content-Length: 89

{
  "error": "invalid_credentials",
  "error_description": "The email or password is incorrect."
}
```

```yaml
set_cookie: absent
response: byte-identical to every other case of S02
audit_records:                            # exactly one
  - action_key: session.sign-in
    actor: absent
    audit_outcome: Failed
    reasons:
      - session.invalid-credentials
      - account.internal-identity-inactive
    detail:
      attempted_identifier_hmac: present
      email: absent                       # the email appears nowhere in the record
```

**Case E — Suspended account, correct password**

When:

```http
POST /api/authentication/sign-in HTTP/1.1
Host: app.entitlement-agent.example
Origin: https://app.entitlement-agent.example
Content-Type: application/json
Content-Length: 65

{
  "email": "dana@provider.example",
  "password": "dana-demo-password"
}
```

Then:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Content-Length: 89

{
  "error": "invalid_credentials",
  "error_description": "The email or password is incorrect."
}
```

```yaml
set_cookie: absent
response: byte-identical to every other case of S02
audit_records:                            # exactly one
  - action_key: session.sign-in
    actor: absent
    audit_outcome: Failed
    reasons:
      - session.invalid-credentials
      - account.operational-suspension
    detail:
      attempted_identifier_hmac: present
      email: absent                       # the email appears nowhere in the record
```

### S03 — A request without a valid token, or for an invalid principal, is rejected

**Level:** `[http]` · every case expects the same response.

**Given** (all cases):

```text
emp_alex signed in at 2026-10-22T14:50:00Z; its valid token T has sub iac_alex, iat 14:50:00, exp 15:20:00.
emp_dana signed in at 2026-10-22T14:50:00Z, before its account was suspended; its token D is validly signed,
with sub iac_dana, iat 14:50:00, exp 15:20:00. iac_dana got the hold OperationalSuspension at 14:55:00.
The instant is 2026-10-22T15:00:00Z.
```

**Case A — No token**

When:

```http
GET /api/authentication/session HTTP/1.1
Host: app.entitlement-agent.example
```

Then:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Content-Length: 78

{
  "error": "invalid_session",
  "error_description": "A valid session is required."
}
```

```yaml
response: byte-identical to every other case of S03
audit_records: none                       # nothing was attempted as a principal
security_event_log: one entry, with the rejection cause
```

**Case B — Expired token**

When:

```http
GET /api/authentication/session HTTP/1.1
Host: app.entitlement-agent.example
Cookie: __Host-session=<T with exp 14:59:59, validly signed>
```

Then:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Content-Length: 78

{
  "error": "invalid_session",
  "error_description": "A valid session is required."
}
```

```yaml
response: byte-identical to every other case of S03
audit_records: none                       # nothing was attempted as a principal
security_event_log: one entry, with the rejection cause
```

**Case C — Altered payload**

When:

```http
GET /api/authentication/session HTTP/1.1
Host: app.entitlement-agent.example
Cookie: __Host-session=<T with sub changed to iac_blair, original signature>
```

Then:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Content-Length: 78

{
  "error": "invalid_session",
  "error_description": "A valid session is required."
}
```

```yaml
response: byte-identical to every other case of S03
audit_records: none                       # nothing was attempted as a principal
security_event_log: one entry, with the rejection cause
```

**Case D — Unsigned token**

When:

```http
GET /api/authentication/session HTTP/1.1
Host: app.entitlement-agent.example
Cookie: __Host-session=<T with header alg none and no signature>
```

Then:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Content-Length: 78

{
  "error": "invalid_session",
  "error_description": "A valid session is required."
}
```

```yaml
response: byte-identical to every other case of S03
audit_records: none                       # nothing was attempted as a principal
security_event_log: one entry, with the rejection cause
```

**Case E — Unknown signing key**

When:

```http
GET /api/authentication/session HTTP/1.1
Host: app.entitlement-agent.example
Cookie: __Host-session=<T signed with a key the server does not hold>
```

Then:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Content-Length: 78

{
  "error": "invalid_session",
  "error_description": "A valid session is required."
}
```

```yaml
response: byte-identical to every other case of S03
audit_records: none                       # nothing was attempted as a principal
security_event_log: one entry, with the rejection cause
```

**Case F — Wrong issuer**

When:

```http
GET /api/authentication/session HTTP/1.1
Host: app.entitlement-agent.example
Cookie: __Host-session=<T with iss someone-else, signed by the server key>
```

Then:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Content-Length: 78

{
  "error": "invalid_session",
  "error_description": "A valid session is required."
}
```

```yaml
response: byte-identical to every other case of S03
audit_records: none                       # nothing was attempted as a principal
security_event_log: one entry, with the rejection cause
```

**Case G — Wrong audience**

When:

```http
GET /api/authentication/session HTTP/1.1
Host: app.entitlement-agent.example
Cookie: __Host-session=<T with aud someone-else, signed by the server key>
```

Then:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Content-Length: 78

{
  "error": "invalid_session",
  "error_description": "A valid session is required."
}
```

```yaml
response: byte-identical to every other case of S03
audit_records: none                       # nothing was attempted as a principal
security_event_log: one entry, with the rejection cause
```

**Case H — Account suspended after sign-in**

When:

```http
GET /api/authentication/session HTTP/1.1
Host: app.entitlement-agent.example
Cookie: __Host-session=<D: a valid token; the principal re-load finds iac_dana suspended>
```

Then:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Content-Length: 78

{
  "error": "invalid_session",
  "error_description": "A valid session is required."
}
```

```yaml
response: byte-identical to every other case of S03
audit_records: none                       # nothing was attempted as a principal
security_event_log: one entry, with the rejection cause
```

### S04a — Renewal before half-life changes nothing

**Level:** `[http]`

**Given:**

```text
emp_alex signed in at 2026-10-22T08:00:00Z: auth_time 08:00:00, sid S. The absolute end is 16:00:00.
The token is validly signed, with sub iac_alex, sid S, auth_time 08:00:00, and jti J.
Half-life is the midpoint between the token's iat and exp.
iac_alex is Active, with no holds.
The token has iat 14:50:00, exp 15:20:00 (half-life 15:05:00).
The instant is 15:00:00.
```

**When:**

```http
POST /api/authentication/session/renewal HTTP/1.1
Host: app.entitlement-agent.example
Origin: https://app.entitlement-agent.example
Cookie: __Host-session=<the token>
Content-Length: 0
```

**Then:**

```http
HTTP/1.1 204 No Content
```

```yaml
set_cookie: absent
audit_records: none                       # nothing changed
```

### S04b — Renewal past half-life re-issues the token in the same session

**Level:** `[http]`

**Given:**

```text
emp_alex signed in at 2026-10-22T08:00:00Z: auth_time 08:00:00, sid S. The absolute end is 16:00:00.
The token is validly signed, with sub iac_alex, sid S, auth_time 08:00:00, and jti J.
Half-life is the midpoint between the token's iat and exp.
iac_alex is Active, with no holds.
The token has iat 14:40:00, exp 15:10:00 (half-life 14:55:00).
The instant is 15:00:00.
```

**When:**

```http
POST /api/authentication/session/renewal HTTP/1.1
Host: app.entitlement-agent.example
Origin: https://app.entitlement-agent.example
Cookie: __Host-session=<the token>
Content-Length: 0
```

**Then:**

```http
HTTP/1.1 204 No Content
Strict-Transport-Security: max-age=31536000; includeSubDomains
Set-Cookie: __Host-session=<renewed token>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=1800
```

```yaml
session_cookie:
  name: __Host-session                    # the prefix: the browser rejects it unless Secure, Path=/, no Domain
  http_only: true                         # page scripts cannot read it
  secure: true                            # sent only over HTTPS
  same_site: Strict                       # never sent on cross-site requests
  path: /                                 # required by the prefix; the agent WebSocket under /agents needs it
  domain: absent                          # bound to this exact host
  max_age: 1800                            # the token's remaining lifetime
renewed_token:
  sub: iac_alex
  sid: S
  auth_time: "08:00:00"
  iat: "15:00:00"
  exp: "15:30:00"
  jti: new, different from J
audit_records:                            # exactly one
  - action_key: session.renew
    actor: iac_alex
    audit_outcome: Succeeded
    session_id: S
```

### S04c — Renewal is capped by the absolute lifetime

**Level:** `[http]`

**Given:**

```text
emp_alex signed in at 2026-10-22T08:00:00Z: auth_time 08:00:00, sid S. The absolute end is 16:00:00.
The token is validly signed, with sub iac_alex, sid S, auth_time 08:00:00, and jti J.
Half-life is the midpoint between the token's iat and exp.
iac_alex is Active, with no holds.
The token has iat 15:40:00, exp 16:00:00 (issued capped; half-life 15:50:00).
The instant is 15:56:00.
```

**When:**

```http
POST /api/authentication/session/renewal HTTP/1.1
Host: app.entitlement-agent.example
Origin: https://app.entitlement-agent.example
Cookie: __Host-session=<the token>
Content-Length: 0
```

**Then:**

```http
HTTP/1.1 204 No Content
Strict-Transport-Security: max-age=31536000; includeSubDomains
Set-Cookie: __Host-session=<renewed token>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=240
```

```yaml
session_cookie:
  name: __Host-session                    # the prefix: the browser rejects it unless Secure, Path=/, no Domain
  http_only: true                         # page scripts cannot read it
  secure: true                            # sent only over HTTPS
  same_site: Strict                       # never sent on cross-site requests
  path: /                                 # required by the prefix; the agent WebSocket under /agents needs it
  domain: absent                          # bound to this exact host
  max_age: 240                             # the token's remaining lifetime
renewed_token:
  sub: iac_alex
  sid: S
  auth_time: "08:00:00"
  iat: "15:56:00"
  exp: "16:00:00"                         # min(15:56 + 30 min, 08:00 + 8 h)
  jti: new, different from J
audit_records:                            # exactly one
  - action_key: session.renew
    actor: iac_alex
    audit_outcome: Succeeded
    session_id: S
```

### S04d — Renewal is refused once the token ends at the absolute lifetime

**Level:** `[http]`

**Given:**

```text
emp_alex signed in at 2026-10-22T08:00:00Z: auth_time 08:00:00, sid S. The absolute end is 16:00:00.
The token is validly signed, with sub iac_alex, sid S, auth_time 08:00:00, and jti J.
Half-life is the midpoint between the token's iat and exp.
iac_alex is Active, with no holds.
The token has iat 15:56:00, exp 16:00:00 (already ends at auth_time + 8 h; half-life 15:58:00).
The instant is 15:59:00.
```

**When:**

```http
POST /api/authentication/session/renewal HTTP/1.1
Host: app.entitlement-agent.example
Origin: https://app.entitlement-agent.example
Cookie: __Host-session=<the token>
Content-Length: 0
```

**Then:**

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json
Content-Length: 101

{
  "error": "absolute_lifetime_reached",
  "error_description": "The session reached its maximum lifetime."
}
```

```yaml
set_cookie: absent                        # the current token keeps working until 16:00:00
audit_records:                            # exactly one
  - action_key: session.renew
    actor: iac_alex
    audit_outcome: Failed
    session_id: S
    reasons:
      - session.absolute-lifetime-reached
```

**And then**, the current token still works until its own expiry, at 15:59:30:

```http
GET /api/authentication/session HTTP/1.1
Host: app.entitlement-agent.example
Cookie: __Host-session=<the token>
```

```http
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 159

{
  "account_id": "iac_alex",
  "display_name": "Alex",
  "department": "customer-support",
  "job_function": "representative",
  "job_level": 1,
  "roles": [
    "support-case-handling"
  ]
}
```

```text
After 16:00:00 the same request answers 401 invalid_session (S04e); the employee signs in again.
```

### S04e — An expired token cannot be renewed

**Level:** `[http]`

**Given:**

```text
emp_alex signed in at 2026-10-22T08:00:00Z: auth_time 08:00:00, sid S. The absolute end is 16:00:00.
The token is validly signed, with sub iac_alex, sid S, auth_time 08:00:00, and jti J.
Half-life is the midpoint between the token's iat and exp.
iac_alex is Active, with no holds.
The token has iat 15:56:00, exp 16:00:00.
The instant is 16:00:01.
```

**When:**

```http
POST /api/authentication/session/renewal HTTP/1.1
Host: app.entitlement-agent.example
Origin: https://app.entitlement-agent.example
Cookie: __Host-session=<the token>
Content-Length: 0
```

**Then:**

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Content-Length: 78

{
  "error": "invalid_session",
  "error_description": "A valid session is required."
}
```

```yaml
set_cookie: absent
audit_records: none                       # an expired token identifies no one
security_event_log: one entry, cause expired
```

### S04f — Renewal re-checks the principal

**Level:** `[http]`

**Given:**

```text
emp_alex signed in at 2026-10-22T08:00:00Z: auth_time 08:00:00, sid S. The absolute end is 16:00:00.
The token is validly signed, with sub iac_alex, sid S, auth_time 08:00:00, and jti J.
Half-life is the midpoint between the token's iat and exp.
iac_alex got the hold OperationalSuspension at 14:55:00.
The token has iat 14:40:00, exp 15:10:00 (half-life 14:55:00).
The instant is 15:00:00.
```

**When:**

```http
POST /api/authentication/session/renewal HTTP/1.1
Host: app.entitlement-agent.example
Origin: https://app.entitlement-agent.example
Cookie: __Host-session=<the token>
Content-Length: 0
```

**Then:**

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Content-Length: 78

{
  "error": "invalid_session",
  "error_description": "A valid session is required."
}
```

```yaml
set_cookie: absent
audit_records:                            # exactly one
  - action_key: session.renew
    actor: iac_alex
    audit_outcome: Failed
    session_id: S
    reasons:
      - session.principal-inactive
      - account.operational-suspension
```

---

## 5. Not in this feature

```text
Declaring an account at sign-in (every employee has one internal account; AN-5 is designed for several).
Account switching; sign-out beyond clearing the cookie; revoking a session before expiry (production-readiness).
Login rate limiting and lockout (production-readiness).
Cases, the agent connection, and closing the WebSocket at token expiry (feature explain-access).
```
