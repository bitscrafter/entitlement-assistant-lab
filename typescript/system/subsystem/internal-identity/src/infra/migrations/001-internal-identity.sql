CREATE TABLE department (
  department_key text PRIMARY KEY CHECK (department_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL
);

CREATE TABLE job_function (
  job_function_key text PRIMARY KEY CHECK (job_function_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL
);

CREATE TABLE internal_identity (
  internal_identity_id uuid PRIMARY KEY,
  identity_kind text NOT NULL CHECK (identity_kind IN ('Employee', 'System')),
  identity_status text NOT NULL CHECK (identity_status IN ('Active', 'Suspended', 'Terminated')),
  created_at timestamptz NOT NULL,
  CONSTRAINT internal_identity_id_kind_unique UNIQUE (internal_identity_id, identity_kind)
);

CREATE TABLE employee (
  internal_identity_id uuid PRIMARY KEY,
  identity_kind text NOT NULL DEFAULT 'Employee' CHECK (identity_kind = 'Employee'),
  department_key text NOT NULL REFERENCES department (department_key),
  job_function_key text NOT NULL REFERENCES job_function (job_function_key),
  email text NOT NULL CHECK (email = lower(btrim(email)) AND email LIKE '%_@_%'),
  given_name text NOT NULL,
  family_name text NOT NULL,
  job_level integer NOT NULL CHECK (job_level > 0),
  CONSTRAINT employee_email_unique UNIQUE (email),
  CONSTRAINT employee_identity_fk FOREIGN KEY (internal_identity_id, identity_kind)
    REFERENCES internal_identity (internal_identity_id, identity_kind)
);

CREATE TABLE system_identity (
  internal_identity_id uuid PRIMARY KEY,
  identity_kind text NOT NULL DEFAULT 'System' CHECK (identity_kind = 'System'),
  name text NOT NULL,
  description text NOT NULL,
  CONSTRAINT system_identity_name_unique UNIQUE (name),
  CONSTRAINT system_identity_identity_fk FOREIGN KEY (internal_identity_id, identity_kind)
    REFERENCES internal_identity (internal_identity_id, identity_kind)
);

CREATE TABLE employee_credential (
  credential_id uuid PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES employee (internal_identity_id),
  credential_kind text NOT NULL CHECK (credential_kind IN ('Password')),
  password_hash text NOT NULL CHECK (password_hash LIKE '$pbkdf2-sha256$%'),
  created_at timestamptz NOT NULL,
  replaced_at timestamptz CHECK (replaced_at IS NULL OR replaced_at >= created_at)
);

CREATE UNIQUE INDEX employee_credential_one_current_per_kind
  ON employee_credential (employee_id, credential_kind) WHERE replaced_at IS NULL;

GRANT SELECT ON department, job_function TO entitlement_agent_app;
GRANT SELECT, INSERT, UPDATE ON internal_identity, employee, system_identity, employee_credential
  TO entitlement_agent_app;
