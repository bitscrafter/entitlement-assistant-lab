-- The account names a case's events show (case-lifecycle D21; review R5-1): kept by Support, never in the audit
-- chain, which names accounts by id only (AT-7). The application only reads and adds them; correcting or erasing
-- one (a data subject's request) is an operator's task with the owner role (production-readiness).
CREATE TABLE case_account_name (
  name_id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES support_case (case_id),
  account_id uuid NOT NULL REFERENCES customer_account (account_id),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 500),
  recorded_at timestamptz NOT NULL
);

CREATE INDEX case_account_name_by_case ON case_account_name (case_id);

GRANT SELECT, INSERT ON case_account_name TO entitlement_assistant_app;
