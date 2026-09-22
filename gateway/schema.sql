-- id は Apple の sub。
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 拡張が Bearer として送る不透明トークン。1 サインイン 1 行。
CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

-- Sign in with Apple のリプレイを防ぐ、短命かつ一度限りの nonce。
CREATE TABLE IF NOT EXISTS oauth_nonces (
  nonce_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

-- StoreKit の現在の契約期間と、その期間内の AI 原価。
-- 金額は浮動小数の誤差を避けるため 1 USD = 1,000,000 microUSD で保存する。
CREATE TABLE IF NOT EXISTS billing (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  app_account_token TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'plus', 'pro')),
  product_id TEXT,
  original_transaction_id TEXT UNIQUE,
  latest_transaction_id TEXT UNIQUE,
  environment TEXT,
  period_start TEXT,
  period_end TEXT,
  allowance_microusd INTEGER NOT NULL DEFAULT 0,
  used_microusd INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AI Gateway の log id を主キーにして、同じリクエストを二重計上しない。
CREATE TABLE IF NOT EXISTS usage_events (
  log_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  period_start TEXT NOT NULL,
  cost_microusd INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS apply_usage_event
AFTER INSERT ON usage_events
BEGIN
  UPDATE billing
  SET used_microusd = used_microusd + NEW.cost_microusd,
      input_tokens = input_tokens + NEW.input_tokens,
      output_tokens = output_tokens + NEW.output_tokens,
      requests = requests + 1,
      updated_at = datetime('now')
  WHERE user_id = NEW.user_id AND period_start = NEW.period_start;
END;

-- StoreKit transaction は監査と再送時の確認用に最小限だけ残す。
CREATE TABLE IF NOT EXISTS storekit_transactions (
  transaction_id TEXT PRIMARY KEY,
  original_transaction_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  purchased_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
