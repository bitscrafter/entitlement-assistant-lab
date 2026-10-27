CREATE TABLE customer_account (
  account_id uuid PRIMARY KEY,
  account_kind text NOT NULL DEFAULT 'Customer' CHECK (account_kind = 'Customer'),
  customer_id uuid NOT NULL,
  customer_kind text NOT NULL CHECK (customer_kind IN ('Organization', 'Individual')),
  account_category text NOT NULL CHECK (account_category IN ('Standalone', 'OrganizationMember')),
  CONSTRAINT customer_account_one_per_customer UNIQUE (customer_id),
  CONSTRAINT customer_account_id_customer_kind_unique UNIQUE (account_id, customer_kind),
  CONSTRAINT customer_account_organization_is_standalone
    CHECK (customer_kind <> 'Organization' OR account_category = 'Standalone'),
  CONSTRAINT customer_account_account_fk FOREIGN KEY (account_id, account_kind)
    REFERENCES account (account_id, account_kind),
  CONSTRAINT customer_account_customer_fk FOREIGN KEY (customer_id, customer_kind)
    REFERENCES customer (customer_id, customer_kind)
);

GRANT SELECT, INSERT ON customer_account TO entitlement_assistant_app;
