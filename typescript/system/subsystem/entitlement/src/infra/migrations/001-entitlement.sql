-- Only a Standalone customer account subscribes: checked by the subscription use case (entitlement §6).
CREATE TABLE subscription (
  subscription_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES customer_account (account_id),
  started_at timestamptz NOT NULL,
  ended_at timestamptz CHECK (ended_at IS NULL OR ended_at >= started_at),
  ended_by uuid REFERENCES account (account_id),
  end_reason text CHECK (end_reason IN ('Canceled', 'CustomerRemoved')),
  CHECK ((ended_at IS NULL) = (ended_by IS NULL) AND (ended_at IS NULL) = (end_reason IS NULL))
);

CREATE UNIQUE INDEX subscription_one_in_force ON subscription (account_id) WHERE ended_at IS NULL;

CREATE TABLE subscription_term (
  term_id uuid PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES subscription (subscription_id),
  plan_key text NOT NULL REFERENCES plan (plan_key),
  source text NOT NULL CHECK (source IN ('FreePlan', 'Payment', 'Contract', 'Trial', 'Courtesy', 'Complimentary')),
  starts_at timestamptz NOT NULL,
  scheduled_end_at timestamptz CHECK (scheduled_end_at IS NULL OR scheduled_end_at > starts_at),
  ended_at timestamptz CHECK (ended_at IS NULL OR ended_at >= starts_at),
  ended_by uuid REFERENCES account (account_id),
  end_reason text CHECK (end_reason IN ('PlanChanged', 'SubscriptionEnded')),
  created_by uuid NOT NULL REFERENCES internal_account (account_id),
  CHECK ((ended_at IS NULL) = (ended_by IS NULL) AND (ended_at IS NULL) = (end_reason IS NULL)),
  CONSTRAINT subscription_term_scheduled_end_by_source
    CHECK (source NOT IN ('Payment', 'Trial', 'Courtesy') OR scheduled_end_at IS NOT NULL)
);

CREATE INDEX subscription_term_by_subscription ON subscription_term (subscription_id, starts_at);

CREATE TABLE subscription_addon (
  subscription_addon_id uuid PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES subscription (subscription_id),
  addon_key text NOT NULL REFERENCES addon (addon_key),
  started_at timestamptz NOT NULL,
  ended_at timestamptz CHECK (ended_at IS NULL OR ended_at >= started_at),
  ended_by uuid REFERENCES account (account_id),
  end_reason text CHECK (end_reason IN ('Removed', 'IncludedByPlan', 'NotEligible', 'SubscriptionEnded')),
  CHECK ((ended_at IS NULL) = (ended_by IS NULL) AND (ended_at IS NULL) = (end_reason IS NULL))
);

CREATE UNIQUE INDEX subscription_addon_one_current
  ON subscription_addon (subscription_id, addon_key) WHERE ended_at IS NULL;

-- A quota only on a metered feature is checked by the grant use case (entitlement §6).
CREATE TABLE entitlement_grant (
  grant_id uuid PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES subscription (subscription_id),
  feature_key text NOT NULL REFERENCES feature (feature_key),
  quota integer CHECK (quota > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  granted_by uuid NOT NULL REFERENCES account (account_id),
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > starts_at),
  ended_at timestamptz CHECK (ended_at IS NULL OR ended_at >= starts_at),
  ended_by uuid REFERENCES account (account_id),
  end_reason text CHECK (end_reason IN ('Revoked', 'Expired', 'SubscriptionEnded')),
  CHECK ((ended_at IS NULL) = (ended_by IS NULL) AND (ended_at IS NULL) = (end_reason IS NULL))
);

CREATE INDEX entitlement_grant_by_subscription ON entitlement_grant (subscription_id) WHERE ended_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON subscription, subscription_term, subscription_addon, entitlement_grant
  TO entitlement_assistant_app;
