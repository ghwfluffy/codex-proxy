export const migrations = [
  {
    id: "0001_gateway_foundation",
    sql: `
CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  subject text UNIQUE NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  monthly_budget_microusd bigint NOT NULL DEFAULT 40000000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash text PRIMARY KEY,
  verifier text NOT NULL,
  next_path text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY,
  owner_id text REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  backend text NOT NULL CHECK (backend IN ('openai_api','codex_subscription')),
  prefix text NOT NULL,
  secret_hash text UNIQUE NOT NULL,
  monthly_budget_microusd bigint,
  rpm integer NOT NULL DEFAULT 60,
  concurrency integer NOT NULL DEFAULT 4,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_keys_owner_active_idx ON api_keys(owner_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS model_prices (
  id uuid PRIMARY KEY,
  model text NOT NULL,
  effective_at timestamptz NOT NULL,
  expires_at timestamptz,
  input_per_million_microusd bigint NOT NULL,
  cached_input_per_million_microusd bigint NOT NULL,
  cache_write_per_million_microusd bigint NOT NULL,
  output_per_million_microusd bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(model, effective_at)
);
CREATE TABLE IF NOT EXISTS usage_requests (
  id uuid PRIMARY KEY,
  api_key_id uuid NOT NULL REFERENCES api_keys(id),
  owner_id text REFERENCES users(id),
  backend text NOT NULL,
  endpoint text NOT NULL,
  requested_model text NOT NULL,
  resolved_model text,
  streaming boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  status_code integer,
  error_class text,
  upstream_request_id text,
  input_tokens bigint NOT NULL DEFAULT 0,
  cached_input_tokens bigint NOT NULL DEFAULT 0,
  cache_write_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  reasoning_tokens bigint NOT NULL DEFAULT 0,
  total_tokens bigint NOT NULL DEFAULT 0,
  reserved_cost_microusd bigint NOT NULL DEFAULT 0,
  estimated_cost_microusd bigint,
  price_id uuid REFERENCES model_prices(id)
);
CREATE INDEX IF NOT EXISTS usage_requests_key_started_idx ON usage_requests(api_key_id, started_at DESC);
CREATE INDEX IF NOT EXISTS usage_requests_owner_started_idx ON usage_requests(owner_id, started_at DESC);
CREATE TABLE IF NOT EXISTS response_threads (
  response_id text PRIMARY KEY,
  api_key_id uuid NOT NULL REFERENCES api_keys(id),
  backend text NOT NULL,
  upstream_response_id text,
  codex_thread_id text,
  status text NOT NULL DEFAULT 'complete',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS alert_deliveries (
  idempotency_key text PRIMARY KEY,
  kind text NOT NULL,
  payload_json jsonb NOT NULL,
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
`
  },
  {
    id: "0002_default_prices",
    sql: `
INSERT INTO model_prices (id, model, effective_at, input_per_million_microusd, cached_input_per_million_microusd, cache_write_per_million_microusd, output_per_million_microusd)
VALUES
  ('10000000-0000-4000-8000-000000000001','gpt-5.6-sol','2026-01-01T00:00:00Z',5000000,500000,6250000,30000000),
  ('10000000-0000-4000-8000-000000000002','gpt-5.6-terra','2026-01-01T00:00:00Z',2500000,250000,3125000,15000000),
  ('10000000-0000-4000-8000-000000000003','gpt-5.6-luna','2026-01-01T00:00:00Z',1000000,100000,1250000,6000000)
ON CONFLICT (model, effective_at) DO NOTHING;
`
  }
] as const;
