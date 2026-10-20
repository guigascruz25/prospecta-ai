ALTER TABLE leads ADD COLUMN follow_up_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN follow_up_status TEXT NOT NULL DEFAULT 'not_scheduled';
ALTER TABLE leads ADD COLUMN follow_up_next_at TEXT NOT NULL DEFAULT '';
