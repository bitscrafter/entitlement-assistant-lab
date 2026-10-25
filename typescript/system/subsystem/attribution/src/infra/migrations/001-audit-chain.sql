-- Attribution is a sink: every reference below is soft, with no foreign key to another subsystem (CM-15).
CREATE TABLE audit_chain_record (
  audit_chain_record_id uuid PRIMARY KEY,
  sequence_number bigint NOT NULL CHECK (sequence_number > 0),
  occurred_at timestamptz NOT NULL,
  actor_account_id uuid,
  session_id uuid,
  trace_id text NOT NULL CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  action_key text NOT NULL CHECK (action_key ~ '^[a-z]+(-[a-z]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$'),
  audit_outcome text NOT NULL CHECK (audit_outcome IN ('Allow', 'Deny', 'Conditional', 'Succeeded', 'Failed')),
  policy_set_version text,
  subject_account_id uuid,
  case_id uuid,
  change_request_id uuid,
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
  hash_key_id text NOT NULL,
  previous_hash bytea NOT NULL CHECK (length(previous_hash) = 32),
  record_hash bytea NOT NULL CHECK (length(record_hash) = 32),
  CONSTRAINT audit_chain_record_sequence_unique UNIQUE (sequence_number),
  CONSTRAINT audit_chain_record_actor_required CHECK (
    actor_account_id IS NOT NULL OR (action_key = 'session.sign-in' AND audit_outcome = 'Failed')
  )
);

CREATE TABLE audit_participant (
  audit_chain_record_id uuid NOT NULL REFERENCES audit_chain_record (audit_chain_record_id),
  participant_role text NOT NULL CHECK (participant_role IN ('Contact', 'Requester', 'Approver')),
  account_id uuid NOT NULL,
  PRIMARY KEY (audit_chain_record_id, participant_role, account_id)
);

CREATE TABLE audit_reason (
  audit_chain_record_id uuid NOT NULL REFERENCES audit_chain_record (audit_chain_record_id),
  reason_code text NOT NULL CHECK (
    reason_code ~ '^(access|entitlement|policy|account|session|support)\.[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  PRIMARY KEY (audit_chain_record_id, reason_code)
);

CREATE TABLE audit_chain_head (
  chain_head_id integer PRIMARY KEY CHECK (chain_head_id = 1),
  last_sequence_number bigint NOT NULL CHECK (last_sequence_number >= 0),
  last_record_hash bytea NOT NULL CHECK (length(last_record_hash) = 32),
  updated_at timestamptz NOT NULL
);

INSERT INTO audit_chain_head (chain_head_id, last_sequence_number, last_record_hash, updated_at)
VALUES (1, 0, decode(repeat('00', 32), 'hex'), now());

GRANT SELECT, INSERT ON audit_chain_record, audit_participant, audit_reason TO entitlement_agent_app;
GRANT SELECT, UPDATE ON audit_chain_head TO entitlement_agent_app;
