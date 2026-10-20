ALTER TABLE leads ADD COLUMN revenue_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE leads ADD COLUMN revenue_evidence TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN meeting_format TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN meeting_time TEXT NOT NULL DEFAULT '';
CREATE TABLE discovery_runs (
 id TEXT PRIMARY KEY, query TEXT NOT NULL, segment TEXT NOT NULL, status TEXT NOT NULL,
 found INTEGER NOT NULL DEFAULT 0, added INTEGER NOT NULL DEFAULT 0, queued INTEGER NOT NULL DEFAULT 0,
 error TEXT, created_at TEXT NOT NULL, finished_at TEXT
);
CREATE TABLE lead_sources (
 lead_id TEXT PRIMARY KEY REFERENCES leads(id), run_id TEXT NOT NULL REFERENCES discovery_runs(id),
 source_url TEXT NOT NULL, locality_evidence TEXT NOT NULL, business_evidence TEXT NOT NULL,
 verified INTEGER NOT NULL DEFAULT 0, verification_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
 address TEXT NOT NULL DEFAULT '', latitude REAL, longitude REAL, geocode_note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX discovery_runs_status ON discovery_runs(status,created_at);
CREATE TABLE geocode_cache (query TEXT PRIMARY KEY, result TEXT NOT NULL, created_at TEXT NOT NULL);
