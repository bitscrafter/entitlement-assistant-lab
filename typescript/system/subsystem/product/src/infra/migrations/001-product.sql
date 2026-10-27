-- The catalog is reference data: seeded, versioned with the code, never changed by the application.
CREATE TABLE product (
  product_key text PRIMARY KEY CHECK (product_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL,
  description text NOT NULL
);

CREATE TABLE feature (
  feature_key text PRIMARY KEY CHECK (feature_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  product_key text NOT NULL REFERENCES product (product_key),
  name text NOT NULL,
  description text NOT NULL,
  metered_unit text CHECK (metered_unit IS NULL OR length(btrim(metered_unit)) > 0)
);

CREATE TABLE feature_operation (
  feature_key text NOT NULL REFERENCES feature (feature_key),
  operation text NOT NULL CHECK (operation ~ '^[a-z]+(-[a-z]+)*$'),
  description text NOT NULL,
  PRIMARY KEY (feature_key, operation)
);

CREATE TABLE plan_ladder (
  plan_ladder_key text PRIMARY KEY CHECK (plan_ladder_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL,
  description text NOT NULL
);

CREATE TABLE plan (
  plan_key text PRIMARY KEY CHECK (plan_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  plan_ladder_key text NOT NULL REFERENCES plan_ladder (plan_ladder_key),
  name text NOT NULL,
  tier_rank integer NOT NULL CHECK (tier_rank > 0),
  plan_category text NOT NULL CHECK (plan_category IN ('Free', 'Paid')),
  CONSTRAINT plan_ladder_rank_unique UNIQUE (plan_ladder_key, tier_rank)
);

CREATE TABLE addon (
  addon_key text PRIMARY KEY CHECK (addon_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL,
  description text NOT NULL
);

-- A quota only on a metered feature, and empty meaning unlimited, is checked when the catalog is loaded.
CREATE TABLE plan_feature_bundle (
  plan_key text NOT NULL REFERENCES plan (plan_key),
  feature_key text NOT NULL REFERENCES feature (feature_key),
  quota integer CHECK (quota > 0),
  PRIMARY KEY (plan_key, feature_key)
);

CREATE TABLE addon_feature_bundle (
  addon_key text NOT NULL REFERENCES addon (addon_key),
  feature_key text NOT NULL REFERENCES feature (feature_key),
  quota integer CHECK (quota > 0),
  PRIMARY KEY (addon_key, feature_key)
);

CREATE TABLE addon_plan_eligibility (
  addon_key text NOT NULL REFERENCES addon (addon_key),
  plan_key text NOT NULL REFERENCES plan (plan_key),
  PRIMARY KEY (addon_key, plan_key)
);

GRANT SELECT ON product, feature, feature_operation, plan_ladder, plan, addon, plan_feature_bundle,
  addon_feature_bundle, addon_plan_eligibility TO entitlement_assistant_app;
