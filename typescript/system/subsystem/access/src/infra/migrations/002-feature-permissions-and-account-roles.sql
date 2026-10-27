ALTER TABLE permission
  ADD CONSTRAINT permission_feature_operation_fk FOREIGN KEY (feature_key, operation)
    REFERENCES feature_operation (feature_key, operation);

CREATE TABLE account_role_assignment (
  assignment_id uuid PRIMARY KEY,
  member_account_id uuid NOT NULL,
  member_customer_kind text NOT NULL DEFAULT 'Individual' CHECK (member_customer_kind = 'Individual'),
  member_of_account_id uuid NOT NULL REFERENCES customer_account (account_id),
  role_key text NOT NULL,
  principal_kind text NOT NULL DEFAULT 'Individual' CHECK (principal_kind = 'Individual'),
  assigned_at timestamptz NOT NULL,
  assigned_by uuid NOT NULL REFERENCES account (account_id),
  ended_at timestamptz CHECK (ended_at IS NULL OR ended_at >= assigned_at),
  ended_by uuid REFERENCES account (account_id),
  end_reason text CHECK (end_reason IN ('Revoked', 'MembershipEnded')),
  CHECK ((ended_at IS NULL) = (ended_by IS NULL) AND (ended_at IS NULL) = (end_reason IS NULL)),
  CONSTRAINT account_role_assignment_member_fk FOREIGN KEY (member_account_id, member_customer_kind)
    REFERENCES customer_account (account_id, customer_kind),
  CONSTRAINT account_role_assignment_role_fk FOREIGN KEY (role_key, principal_kind)
    REFERENCES role (role_key, principal_kind)
);

CREATE UNIQUE INDEX account_role_assignment_one_active
  ON account_role_assignment (member_account_id, member_of_account_id, role_key) WHERE ended_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON account_role_assignment TO entitlement_assistant_app;
