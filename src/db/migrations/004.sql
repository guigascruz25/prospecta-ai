ALTER TABLE discovery_runs ADD COLUMN sources_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE discovery_runs ADD COLUMN search_cost REAL NOT NULL DEFAULT 0;
