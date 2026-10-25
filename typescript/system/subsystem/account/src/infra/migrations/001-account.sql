CREATE TABLE account (
  account_id uuid PRIMARY KEY,
  account_kind text NOT NULL CHECK (account_kind IN ('Customer', 'Internal')),
  account_display_name text NOT NULL CHECK (length(btrim(account_display_name)) > 0),
  account_status text NOT NULL CHECK (account_status IN ('Active', 'Suspended')),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL,
  CONSTRAINT account_id_kind_unique UNIQUE (account_id, account_kind)
);

CREATE TABLE internal_account (
  account_id uuid PRIMARY KEY,
  account_kind text NOT NULL DEFAULT 'Internal' CHECK (account_kind = 'Internal'),
  internal_identity_id uuid NOT NULL,
  identity_kind text NOT NULL CHECK (identity_kind IN ('Employee', 'System')),
  CONSTRAINT internal_account_one_per_identity UNIQUE (internal_identity_id),
  CONSTRAINT internal_account_id_identity_kind_unique UNIQUE (account_id, identity_kind),
  CONSTRAINT internal_account_account_fk FOREIGN KEY (account_id, account_kind)
    REFERENCES account (account_id, account_kind),
  CONSTRAINT internal_account_identity_fk FOREIGN KEY (internal_identity_id, identity_kind)
    REFERENCES internal_identity (internal_identity_id, identity_kind)
);

CREATE TABLE account_hold (
  hold_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account (account_id),
  hold_reason text NOT NULL CHECK (
    hold_reason IN ('OperationalSuspension', 'CustomerRemoved', 'NoActiveMembership', 'InternalIdentityInactive')
  ),
  placed_at timestamptz NOT NULL,
  placed_by uuid NOT NULL REFERENCES account (account_id),
  released_at timestamptz,
  released_by uuid REFERENCES account (account_id),
  CHECK ((released_at IS NULL) = (released_by IS NULL)),
  CHECK (released_at IS NULL OR released_at >= placed_at)
);

CREATE INDEX account_hold_unreleased ON account_hold (account_id) WHERE released_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON account, internal_account, account_hold TO entitlement_assistant_app;
