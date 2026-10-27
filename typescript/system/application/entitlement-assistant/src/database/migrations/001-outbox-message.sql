-- The transactional outbox (grants-and-approvals D6): a message is written in the same transaction as the change it
-- is about, then delivered to its destination at least once, after commit and by the scheduled sweep. Payloads hold
-- ids and codes only, never personal data (AT-7).
CREATE TABLE outbox_message (
  message_id uuid PRIMARY KEY,
  destination text NOT NULL CHECK (destination ~ '^[a-z]+(-[a-z]+)*(:[a-z0-9-]+)?$'),
  message_type text NOT NULL CHECK (message_type ~ '^[a-z]+(-[a-z]+)*$'),
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL,
  delivered_at timestamptz CHECK (delivered_at IS NULL OR delivered_at >= created_at),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text
);

CREATE INDEX outbox_message_undelivered ON outbox_message (destination, created_at) WHERE delivered_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON outbox_message TO entitlement_assistant_app;
