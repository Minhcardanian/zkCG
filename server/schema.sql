CREATE TABLE IF NOT EXISTS applications (
  id uuid PRIMARY KEY,
  commitment text NOT NULL UNIQUE,
  reference text NOT NULL,
  synthetic_age integer NOT NULL,
  synthetic_jurisdiction text NOT NULL,
  synthetic_screening_clear boolean NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS operations (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES applications(id),
  kind text NOT NULL CHECK (kind IN ('approval', 'revocation')),
  status text NOT NULL CHECK (status IN ('preparing', 'pending', 'confirmed', 'failed', 'unknown')),
  tx_hash text UNIQUE,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE operations ADD COLUMN IF NOT EXISTS actor_wallet text;
CREATE UNIQUE INDEX IF NOT EXISTS operations_one_unresolved ON operations (application_id) WHERE status IN ('preparing', 'pending', 'unknown');
CREATE TABLE IF NOT EXISTS deployment_binding (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  fingerprint text NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_challenges (
  id uuid PRIMARY KEY,
  wallet_address text NOT NULL,
  origin text NOT NULL,
  message text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash text PRIMARY KEY,
  wallet_address text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
