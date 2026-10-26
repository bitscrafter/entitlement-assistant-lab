-- A registered policy set never changes (policy §8): the application inserts and reads, nothing else.
CREATE TABLE policy_set (
  policy_set_version text PRIMARY KEY CHECK (policy_set_version ~ '^[A-Za-z0-9_-]{43}$'),
  scm_revision text NOT NULL,
  registered_at timestamptz NOT NULL,
  registered_by uuid NOT NULL REFERENCES account (account_id)
);

CREATE TABLE policy (
  policy_set_version text NOT NULL REFERENCES policy_set (policy_set_version),
  policy_key text NOT NULL CHECK (policy_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text NOT NULL,
  applies_when text NOT NULL,
  requires text NOT NULL,
  unmet_outcome text NOT NULL CHECK (unmet_outcome IN ('Deny', 'Conditional')),
  PRIMARY KEY (policy_set_version, policy_key)
);

CREATE TABLE policy_governed_action (
  policy_set_version text NOT NULL,
  policy_key text NOT NULL,
  action_key text NOT NULL,
  PRIMARY KEY (policy_set_version, policy_key, action_key),
  CONSTRAINT policy_governed_action_policy_fk FOREIGN KEY (policy_set_version, policy_key)
    REFERENCES policy (policy_set_version, policy_key)
);

CREATE TABLE policy_prerequisite (
  policy_set_version text NOT NULL,
  policy_key text NOT NULL,
  prerequisite_kind text NOT NULL CHECK (prerequisite_kind IN ('Approval')),
  fulfilled_by_permission text NOT NULL REFERENCES permission (permission_key),
  PRIMARY KEY (policy_set_version, policy_key, prerequisite_kind),
  CONSTRAINT policy_prerequisite_policy_fk FOREIGN KEY (policy_set_version, policy_key)
    REFERENCES policy (policy_set_version, policy_key)
);

CREATE TABLE policy_set_activation (
  activation_id uuid PRIMARY KEY,
  policy_set_version text NOT NULL REFERENCES policy_set (policy_set_version),
  activated_at timestamptz NOT NULL,
  activated_by uuid NOT NULL REFERENCES account (account_id),
  ended_at timestamptz CHECK (ended_at IS NULL OR ended_at >= activated_at),
  ended_by uuid REFERENCES account (account_id),
  CHECK ((ended_at IS NULL) = (ended_by IS NULL))
);

GRANT SELECT, INSERT ON policy_set, policy, policy_governed_action, policy_prerequisite TO entitlement_assistant_app;
GRANT SELECT, INSERT, UPDATE ON policy_set_activation TO entitlement_assistant_app;
