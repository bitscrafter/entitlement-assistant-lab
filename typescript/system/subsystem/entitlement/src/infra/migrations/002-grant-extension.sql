-- An extension ends the active grant and starts a linked one (grants-and-approvals D13): no row's dates are edited.
ALTER TABLE entitlement_grant DROP CONSTRAINT entitlement_grant_end_reason_check;
ALTER TABLE entitlement_grant
  ADD CONSTRAINT entitlement_grant_end_reason_check
    CHECK (end_reason IN ('Revoked', 'Expired', 'SubscriptionEnded', 'Extended')),
  ADD COLUMN extends_grant_id uuid REFERENCES entitlement_grant (grant_id);

CREATE UNIQUE INDEX entitlement_grant_extended_once ON entitlement_grant (extends_grant_id)
  WHERE extends_grant_id IS NOT NULL;

-- The day limits read an account's grants of one feature, ended ones included (grants-and-approvals D5; review R2-1).
CREATE INDEX subscription_by_account ON subscription (account_id);
CREATE INDEX entitlement_grant_by_subscription_feature ON entitlement_grant (subscription_id, feature_key);
