CREATE TABLE customer (
  customer_id uuid PRIMARY KEY,
  customer_kind text NOT NULL CHECK (customer_kind IN ('Organization', 'Individual')),
  customer_status text NOT NULL CHECK (customer_status IN ('Active', 'Removed')),
  created_at timestamptz NOT NULL,
  CONSTRAINT customer_id_kind_unique UNIQUE (customer_id, customer_kind)
);

CREATE TABLE organization (
  customer_id uuid PRIMARY KEY,
  customer_kind text NOT NULL DEFAULT 'Organization' CHECK (customer_kind = 'Organization'),
  legal_name text NOT NULL CHECK (length(btrim(legal_name)) > 0),
  primary_domain text CHECK (primary_domain = lower(btrim(primary_domain))),
  created_at timestamptz NOT NULL,
  CONSTRAINT organization_primary_domain_unique UNIQUE (primary_domain),
  CONSTRAINT organization_customer_fk FOREIGN KEY (customer_id, customer_kind)
    REFERENCES customer (customer_id, customer_kind)
);

CREATE TABLE individual (
  customer_id uuid PRIMARY KEY,
  customer_kind text NOT NULL DEFAULT 'Individual' CHECK (customer_kind = 'Individual'),
  email text NOT NULL CHECK (email = lower(btrim(email)) AND email LIKE '%_@_%'),
  given_name text NOT NULL,
  family_name text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT individual_email_unique UNIQUE (email),
  CONSTRAINT individual_customer_fk FOREIGN KEY (customer_id, customer_kind)
    REFERENCES customer (customer_id, customer_kind)
);

CREATE TABLE organization_membership (
  membership_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organization (customer_id),
  individual_id uuid NOT NULL REFERENCES individual (customer_id),
  joined_at timestamptz NOT NULL,
  ended_at timestamptz CHECK (ended_at IS NULL OR ended_at >= joined_at),
  end_reason text CHECK (end_reason IN ('Left', 'Removed')),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);

CREATE UNIQUE INDEX organization_membership_one_active
  ON organization_membership (individual_id) WHERE ended_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON customer, organization, individual, organization_membership
  TO entitlement_assistant_app;
