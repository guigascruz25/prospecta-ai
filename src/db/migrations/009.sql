CREATE TABLE outbound_webhook_deliveries (
 id TEXT PRIMARY KEY,
 destination TEXT NOT NULL,
 lead_id TEXT,
 kind TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 http_status INTEGER,
 created_at TEXT NOT NULL,
 finished_at TEXT,
 UNIQUE(destination,lead_id,kind)
);
