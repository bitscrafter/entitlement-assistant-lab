CREATE TABLE resource_operation (
  resource_type text NOT NULL CHECK (resource_type ~ '^[a-z]+(-[a-z]+)*$'),
  operation text NOT NULL CHECK (operation ~ '^[a-z]+(-[a-z]+)*$'),
  description text NOT NULL,
  PRIMARY KEY (resource_type, operation)
);

-- Feature permissions (feature_key) arrive with the Product subsystem's feature_operation table.
CREATE TABLE permission (
  permission_key text PRIMARY KEY,
  principal_kind text NOT NULL CHECK (principal_kind IN ('Individual', 'Employee', 'System')),
  operation text NOT NULL,
  resource_type text,
  feature_key text,
  description text NOT NULL,
  CONSTRAINT permission_key_principal_kind_unique UNIQUE (permission_key, principal_kind),
  CONSTRAINT permission_resource_operation_fk FOREIGN KEY (resource_type, operation)
    REFERENCES resource_operation (resource_type, operation),
  CHECK ((resource_type IS NULL) <> (feature_key IS NULL)),
  CHECK (
    (resource_type IS NOT NULL AND permission_key = resource_type || '.' || operation)
    OR (feature_key IS NOT NULL AND permission_key = 'feature.' || feature_key || '.' || operation)
  )
);

CREATE TABLE role (
  role_key text PRIMARY KEY CHECK (role_key ~ '^[a-z]+(-[a-z]+)*$'),
  principal_kind text NOT NULL CHECK (principal_kind IN ('Individual', 'Employee', 'System')),
  name text NOT NULL,
  description text NOT NULL,
  CONSTRAINT role_key_principal_kind_unique UNIQUE (role_key, principal_kind)
);

CREATE TABLE role_permission (
  role_key text NOT NULL,
  permission_key text NOT NULL,
  principal_kind text NOT NULL,
  PRIMARY KEY (role_key, permission_key),
  CONSTRAINT role_permission_role_fk FOREIGN KEY (role_key, principal_kind)
    REFERENCES role (role_key, principal_kind),
  CONSTRAINT role_permission_permission_fk FOREIGN KEY (permission_key, principal_kind)
    REFERENCES permission (permission_key, principal_kind)
);

CREATE TABLE birthright_role_assignment (
  department_key text NOT NULL REFERENCES department (department_key),
  job_function_key text NOT NULL REFERENCES job_function (job_function_key),
  minimum_job_level integer NOT NULL CHECK (minimum_job_level > 0),
  role_key text NOT NULL,
  principal_kind text NOT NULL DEFAULT 'Employee' CHECK (principal_kind = 'Employee'),
  PRIMARY KEY (department_key, job_function_key, minimum_job_level, role_key),
  CONSTRAINT birthright_role_assignment_role_fk FOREIGN KEY (role_key, principal_kind)
    REFERENCES role (role_key, principal_kind)
);

CREATE TABLE internal_role_assignment (
  assignment_id uuid PRIMARY KEY,
  internal_account_id uuid NOT NULL,
  role_key text NOT NULL,
  principal_kind text NOT NULL CHECK (principal_kind IN ('Employee', 'System')),
  reason text NOT NULL,
  assigned_at timestamptz NOT NULL,
  assigned_by uuid NOT NULL REFERENCES account (account_id),
  expires_at timestamptz CHECK (expires_at IS NULL OR expires_at > assigned_at),
  ended_at timestamptz CHECK (ended_at IS NULL OR ended_at >= assigned_at),
  ended_by uuid REFERENCES account (account_id),
  end_reason text CHECK (end_reason IN ('Revoked')),
  CHECK ((ended_at IS NULL) = (ended_by IS NULL) AND (ended_at IS NULL) = (end_reason IS NULL)),
  CONSTRAINT internal_role_assignment_account_fk FOREIGN KEY (internal_account_id, principal_kind)
    REFERENCES internal_account (account_id, identity_kind),
  CONSTRAINT internal_role_assignment_role_fk FOREIGN KEY (role_key, principal_kind)
    REFERENCES role (role_key, principal_kind)
);

CREATE UNIQUE INDEX internal_role_assignment_one_active
  ON internal_role_assignment (internal_account_id, role_key) WHERE ended_at IS NULL;

CREATE TABLE internal_permission_assignment (
  assignment_id uuid PRIMARY KEY,
  internal_account_id uuid NOT NULL,
  permission_key text NOT NULL,
  principal_kind text NOT NULL CHECK (principal_kind IN ('Employee', 'System')),
  reason text NOT NULL,
  assigned_at timestamptz NOT NULL,
  assigned_by uuid NOT NULL REFERENCES account (account_id),
  expires_at timestamptz NOT NULL CHECK (expires_at > assigned_at),
  ended_at timestamptz CHECK (ended_at IS NULL OR ended_at >= assigned_at),
  ended_by uuid REFERENCES account (account_id),
  end_reason text CHECK (end_reason IN ('Revoked')),
  CHECK ((ended_at IS NULL) = (ended_by IS NULL) AND (ended_at IS NULL) = (end_reason IS NULL)),
  CONSTRAINT internal_permission_assignment_account_fk FOREIGN KEY (internal_account_id, principal_kind)
    REFERENCES internal_account (account_id, identity_kind),
  CONSTRAINT internal_permission_assignment_permission_fk FOREIGN KEY (permission_key, principal_kind)
    REFERENCES permission (permission_key, principal_kind)
);

GRANT SELECT ON resource_operation, permission, role, role_permission, birthright_role_assignment
  TO entitlement_agent_app;
GRANT SELECT, INSERT, UPDATE ON internal_role_assignment, internal_permission_assignment TO entitlement_agent_app;
