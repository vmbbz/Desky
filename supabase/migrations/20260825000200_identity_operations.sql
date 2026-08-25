BEGIN;

CREATE TABLE desky_commerce.commerce_identities (
  account_id text PRIMARY KEY,
  provider text NOT NULL,
  provider_subject_digest text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE desky_commerce.commerce_installations (
  account_id text NOT NULL REFERENCES desky_commerce.commerce_identities(account_id),
  installation_id text NOT NULL,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (account_id, installation_id)
);

CREATE TABLE desky_commerce.commerce_recovery_credentials (
  recovery_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES desky_commerce.commerce_identities(account_id),
  credential_digest text NOT NULL UNIQUE,
  proof_key_challenge text NOT NULL,
  idempotency_key text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_idempotency_key text,
  created_at timestamptz NOT NULL,
  UNIQUE (account_id, idempotency_key)
);

CREATE INDEX commerce_refresh_sessions_account_installation
  ON desky_commerce.commerce_refresh_sessions(account_id, installation_id);

CREATE TABLE desky_commerce.commerce_rate_limit_windows (
  rate_key text NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (rate_key, window_started_at)
);

INSERT INTO desky_commerce.commerce_schema_migrations(version) VALUES (2);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  desky_commerce.commerce_identities,
  desky_commerce.commerce_installations,
  desky_commerce.commerce_recovery_credentials,
  desky_commerce.commerce_rate_limit_windows
  TO desky_checkout_runtime;

COMMIT;
