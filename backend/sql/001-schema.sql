CREATE TABLE IF NOT EXISTS tenants (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL,
  accepting_orders boolean NOT NULL DEFAULT true,
  disabled_features jsonb NOT NULL DEFAULT '[]',
  restriction_reason text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS records (
  tenant_id text NOT NULL REFERENCES tenants(id), kind text NOT NULL, id text NOT NULL,
  data jsonb NOT NULL, revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,kind,id)
);
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, email text UNIQUE NOT NULL, password text NOT NULL,
  name text NOT NULL, role text NOT NULL CHECK(role IN ('platform','owner','manager','operator','analyst')),
  tenant_id text REFERENCES tenants(id), active boolean NOT NULL DEFAULT true,
  totp_secret text, totp_pending text, totp_step bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((role='platform' AND tenant_id IS NULL) OR (role<>'platform' AND tenant_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), csrf text NOT NULL,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS customers (
  id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id), phone_hash text NOT NULL,
  phone_encrypted text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,phone_hash), UNIQUE(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS customer_sessions (
  token_hash text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id), customer_id text NOT NULL,
  expires_at timestamptz NOT NULL, FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS call_challenges (
  id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id), proof_hash text NOT NULL,
  phone_hash text NOT NULL, phone_encrypted text NOT NULL, provider_id text NOT NULL,
  expires_at timestamptz NOT NULL, consumed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id), brand_id text NOT NULL,
  branch_id text NOT NULL, customer_id text, idempotency_key text NOT NULL, request_hash text NOT NULL,
  status text NOT NULL, payment_status text NOT NULL, mode text NOT NULL CHECK(mode IN ('sandbox','live')),
  data jsonb NOT NULL, total integer NOT NULL CHECK(total>=0),
  revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,idempotency_key), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS orders_scope_date ON orders(tenant_id,created_at);
CREATE TABLE IF NOT EXISTS audit (
  id bigserial PRIMARY KEY, tenant_id text REFERENCES tenants(id), actor text NOT NULL,
  action text NOT NULL, target text NOT NULL, details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_scope_date ON audit(tenant_id,created_at);
CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id), order_id text NOT NULL REFERENCES orders(id),
  type text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id), order_id text NOT NULL REFERENCES orders(id),
  provider_id text, status text NOT NULL, amount integer NOT NULL, data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,provider_id)
);
CREATE TABLE IF NOT EXISTS invoices (
  id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id), period text NOT NULL,
  amount integer NOT NULL CHECK(amount>=0), status text NOT NULL DEFAULT 'unpaid',
  due_at timestamptz NOT NULL, data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,period)
);
CREATE TABLE IF NOT EXISTS outbox (
  id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id), dedup_key text UNIQUE NOT NULL,
  recipient text NOT NULL, subject text NOT NULL, body text NOT NULL,
  status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
  last_error text, next_attempt timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rate_buckets (
  key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL
);
