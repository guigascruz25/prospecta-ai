CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO settings VALUES ('paused','true'),('pause_reason','Instalação pronta. Inicie uma simulação para testar.'),('worker_heartbeat',''),('last_browser_send',''),('live_started_at','');
CREATE TABLE IF NOT EXISTS leads (
 id TEXT PRIMARY KEY, handle TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('simulation','live')),
 name TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', niche TEXT NOT NULL DEFAULT '',
 funnel TEXT NOT NULL CHECK(funnel IN ('customer','affiliate')),
 stage TEXT NOT NULL DEFAULT 'discovered', channel TEXT NOT NULL DEFAULT 'browser_contact_pending',
 score INTEGER NOT NULL DEFAULT 0, variant TEXT NOT NULL DEFAULT 'A',
 monthly_revenue REAL, city TEXT NOT NULL DEFAULT '', meta_id TEXT,
 last_inbound_at TEXT, next_action TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(handle,mode), UNIQUE(meta_id,mode)
);
CREATE TABLE IF NOT EXISTS do_not_contact (handle TEXT PRIMARY KEY, reason TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (
 id TEXT PRIMARY KEY, lead_id TEXT NOT NULL REFERENCES leads(id), direction TEXT NOT NULL,
 channel TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
 external_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
 id TEXT PRIMARY KEY, lead_id TEXT REFERENCES leads(id), kind TEXT NOT NULL,
 payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0, run_at TEXT NOT NULL, locked_at TEXT,
 idempotency_key TEXT NOT NULL UNIQUE, error TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status,run_at);
CREATE TABLE IF NOT EXISTS events (
 id TEXT PRIMARY KEY, lead_id TEXT REFERENCES leads(id), kind TEXT NOT NULL,
 detail TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_calls (
 id TEXT PRIMARY KEY, lead_id TEXT REFERENCES leads(id), model TEXT NOT NULL,
 input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, estimated_cost REAL NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_receipts (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS exceptions (
 id TEXT PRIMARY KEY, lead_id TEXT REFERENCES leads(id), reason TEXT NOT NULL,
 resolved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS strategies (id TEXT PRIMARY KEY, variant TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
