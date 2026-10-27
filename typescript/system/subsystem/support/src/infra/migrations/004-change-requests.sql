-- Change requests and their approvals (SU-3 to SU-6, SU-15; grants-and-approvals D1-D9, D14).
CREATE TABLE change_request (
  change_request_id uuid PRIMARY KEY,
  case_id uuid NOT NULL,
  subject_account_id uuid NOT NULL,
  change_kind text NOT NULL CHECK (change_kind IN ('CreateGrant', 'RevokeGrant', 'ExtendGrant')),
  parameters jsonb NOT NULL CHECK (jsonb_typeof(parameters) = 'object'),
  entitlement_diff jsonb NOT NULL CHECK (jsonb_typeof(entitlement_diff) = 'array'),
  subject_account_version integer NOT NULL CHECK (subject_account_version >= 0),
  preview_outcome text NOT NULL CHECK (preview_outcome IN ('Allow', 'Deny', 'Conditional')),
  preview_reason_codes jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(preview_reason_codes) = 'array'),
  change_status text NOT NULL CHECK (
    change_status IN ('AwaitingConfirmation', 'AwaitingApproval', 'Applied', 'Refused', 'Canceled', 'Expired')
  ),
  status_reason text,
  contact_account_id uuid REFERENCES customer_account (account_id),
  contact_authenticated_at timestamptz,
  requested_by uuid NOT NULL REFERENCES account (account_id),
  requested_at timestamptz NOT NULL,
  confirmed_by uuid REFERENCES account (account_id),
  confirmed_at timestamptz,
  confirmation_response jsonb,
  applied_by uuid REFERENCES account (account_id),
  applied_at timestamptz,
  created_grant_id uuid REFERENCES entitlement_grant (grant_id),
  CONSTRAINT change_request_case_subject_fk FOREIGN KEY (case_id, subject_account_id)
    REFERENCES support_case (case_id, subject_account_id),
  CHECK ((confirmed_at IS NULL) = (confirmed_by IS NULL)),
  CHECK ((applied_at IS NULL) = (applied_by IS NULL)),
  CHECK (contact_authenticated_at IS NULL OR contact_account_id IS NOT NULL)
);

CREATE INDEX change_request_by_case ON change_request (case_id);

CREATE TABLE change_approval (
  approval_id uuid PRIMARY KEY,
  change_request_id uuid NOT NULL UNIQUE REFERENCES change_request (change_request_id),
  approval_status text NOT NULL CHECK (approval_status IN ('Pending', 'Approved', 'Denied', 'Expired', 'Canceled')),
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > requested_at),
  decided_by uuid REFERENCES account (account_id),
  decided_at timestamptz,
  decision_reason text CHECK (
    decision_reason IN ('PolicyLimit', 'InsufficientJustification', 'CustomerNotEligible', 'Other')
  ),
  decision_comment text,
  CHECK ((decided_at IS NULL) = (decided_by IS NULL)),
  CHECK (decision_reason IS NULL OR approval_status = 'Denied'),
  CHECK (approval_status <> 'Denied' OR decision_reason IS NOT NULL),
  CHECK (decision_reason <> 'Other' OR length(btrim(coalesce(decision_comment, ''))) > 0)
);

CREATE INDEX change_approval_pending ON change_approval (expires_at) WHERE approval_status = 'Pending';

GRANT SELECT, INSERT, UPDATE ON change_request, change_approval TO entitlement_assistant_app;
