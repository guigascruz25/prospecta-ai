ALTER TABLE lead_sources ADD COLUMN address_source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE discovery_runs ADD COLUMN candidates_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE discovery_runs ADD COLUMN rejection_notes TEXT NOT NULL DEFAULT '[]';
