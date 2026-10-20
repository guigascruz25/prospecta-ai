ALTER TABLE leads ADD COLUMN purpose TEXT NOT NULL DEFAULT 'prospect' CHECK(purpose IN ('prospect','pilot'));
