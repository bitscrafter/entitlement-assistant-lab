-- Change requests and approvals arrive with the change-subscription feature.
CREATE TABLE support_case (
  case_id uuid PRIMARY KEY,
  subject_account_id uuid REFERENCES customer_account (account_id),
  contact_account_id uuid,
  contact_customer_kind text NOT NULL DEFAULT 'Individual' CHECK (contact_customer_kind = 'Individual'),
  contact_authenticated_at timestamptz,
  contact_authentication_kind text CHECK (contact_authentication_kind IN ('KnowledgeFactor', 'OneTimeCode')),
  contact_authenticated_by uuid REFERENCES account (account_id),
  opened_at timestamptz NOT NULL,
  opened_by uuid NOT NULL REFERENCES account (account_id),
  closed_at timestamptz CHECK (closed_at IS NULL OR closed_at >= opened_at),
  closed_by uuid REFERENCES account (account_id),
  close_reason text CHECK (close_reason IN ('Resolved', 'Abandoned')),
  case_summary text,
  CONSTRAINT support_case_id_subject_unique UNIQUE (case_id, subject_account_id),
  CONSTRAINT support_case_contact_fk FOREIGN KEY (contact_account_id, contact_customer_kind)
    REFERENCES customer_account (account_id, customer_kind),
  CHECK (
    (contact_authenticated_at IS NULL) = (contact_authentication_kind IS NULL)
    AND (contact_authenticated_at IS NULL) = (contact_authenticated_by IS NULL)
  ),
  CHECK (contact_authenticated_at IS NULL OR contact_account_id IS NOT NULL),
  CHECK ((closed_at IS NULL) = (closed_by IS NULL) AND (closed_at IS NULL) = (close_reason IS NULL))
);

CREATE TABLE case_assignment (
  assignment_id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES support_case (case_id),
  assignee_account_id uuid NOT NULL REFERENCES internal_account (account_id),
  assigned_at timestamptz NOT NULL,
  assigned_by uuid NOT NULL REFERENCES account (account_id),
  ended_at timestamptz CHECK (ended_at IS NULL OR ended_at >= assigned_at),
  ended_by uuid REFERENCES account (account_id),
  end_reason text CHECK (end_reason IN ('Reassigned', 'CaseClosed')),
  CHECK ((ended_at IS NULL) = (ended_by IS NULL) AND (ended_at IS NULL) = (end_reason IS NULL))
);

CREATE UNIQUE INDEX case_assignment_one_current ON case_assignment (case_id) WHERE ended_at IS NULL;
CREATE INDEX case_assignment_by_assignee ON case_assignment (assignee_account_id) WHERE ended_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON support_case, case_assignment TO entitlement_assistant_app;
