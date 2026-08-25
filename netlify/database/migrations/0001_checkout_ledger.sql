BEGIN;

CREATE TABLE commerce_quotes (
  quote_id text PRIMARY KEY,
  account_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  payload_text text NOT NULL
);

CREATE TABLE commerce_orders (
  order_id text PRIMARY KEY,
  quote_id text NOT NULL REFERENCES commerce_quotes(quote_id),
  account_id text NOT NULL,
  idempotency_key text NOT NULL,
  payload_text text NOT NULL,
  UNIQUE (account_id, idempotency_key)
);

CREATE TABLE commerce_checkout_sessions (
  checkout_session_id text PRIMARY KEY,
  approval_id text NOT NULL UNIQUE,
  account_id text NOT NULL,
  installation_id text NOT NULL,
  idempotency_key text NOT NULL,
  order_id text NOT NULL REFERENCES commerce_orders(order_id),
  expires_at timestamptz NOT NULL,
  payload_text text NOT NULL,
  UNIQUE (account_id, idempotency_key)
);

CREATE TABLE payment_attempts (
  attempt_id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES commerce_orders(order_id),
  quote_id text NOT NULL REFERENCES commerce_quotes(quote_id),
  provider text NOT NULL,
  payload_text text NOT NULL
);

CREATE UNIQUE INDEX payment_attempts_one_active_per_order
  ON payment_attempts(order_id)
  WHERE (payload_text::jsonb ->> 'state') <> 'failed';

CREATE TABLE payment_authorizations (
  authorization_id text PRIMARY KEY,
  attempt_id text NOT NULL UNIQUE REFERENCES payment_attempts(attempt_id),
  provider text NOT NULL,
  network text NOT NULL,
  payment_identifier text NOT NULL,
  payload_text text NOT NULL,
  UNIQUE (provider, network, payment_identifier)
);

CREATE TABLE settlement_provider_references (
  provider text NOT NULL,
  network text NOT NULL,
  provider_reference text NOT NULL,
  authorization_id text NOT NULL REFERENCES payment_authorizations(authorization_id),
  PRIMARY KEY (provider, network, provider_reference)
);

CREATE TABLE settlement_observations (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  observation_id text NOT NULL UNIQUE,
  authorization_id text NOT NULL REFERENCES payment_authorizations(authorization_id),
  attempt_id text NOT NULL REFERENCES payment_attempts(attempt_id),
  settlement_status text NOT NULL CHECK (
    settlement_status IN ('unknown', 'pending', 'settled', 'failed')
  ),
  reconciliation_id text NOT NULL UNIQUE,
  payload_text text NOT NULL
);

CREATE INDEX settlement_observations_authorization_sequence
  ON settlement_observations(authorization_id, sequence DESC);

CREATE TABLE entitlement_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id text NOT NULL UNIQUE,
  account_id text NOT NULL,
  product_id text NOT NULL,
  event_type text NOT NULL,
  source text NOT NULL,
  source_reference text NOT NULL,
  payload_text text NOT NULL,
  UNIQUE (account_id, product_id, event_type, source, source_reference)
);

CREATE TABLE asset_grants (
  grant_id text PRIMARY KEY,
  entitlement_event_id text NOT NULL UNIQUE REFERENCES entitlement_events(event_id),
  account_id text NOT NULL,
  product_id text NOT NULL,
  payload_text text NOT NULL
);

CREATE TABLE commerce_refresh_sessions (
  session_id text PRIMARY KEY,
  account_id text NOT NULL,
  installation_id text NOT NULL,
  credential_digest text NOT NULL,
  previous_credential_digest text,
  generation bigint NOT NULL CHECK (generation >= 0),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  payload_text text NOT NULL
);

CREATE TABLE commerce_audit_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id text NOT NULL UNIQUE,
  account_id text,
  subject_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  correlation_id text NOT NULL,
  payload_text text NOT NULL
);

CREATE TABLE commerce_schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commerce_health_probe (
  probe_key text PRIMARY KEY CHECK (probe_key = 'primary'),
  checked_at timestamptz NOT NULL
);

INSERT INTO commerce_schema_migrations(version) VALUES (1);

COMMIT;
