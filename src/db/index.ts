import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env } from '../lib/config';
import * as schema from './schema';

const databasePath = resolve(env.DATABASE_URL.replace(/^file:/, ''));
mkdirSync(dirname(databasePath), { recursive: true });
export const sqlite = new Database(databasePath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');
sqlite.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
for (const migration of ['001','002','003','004','005','006','007','008','009']) {
  sqlite.transaction(() => {
    if (sqlite.prepare('SELECT name FROM migrations WHERE name = ?').get(migration)) return;
    sqlite.exec(readFileSync(resolve(`src/db/migrations/${migration}.sql`), 'utf8'));
    sqlite.prepare('INSERT INTO migrations VALUES (?,?)').run(migration, new Date().toISOString());
  }).immediate();
}
export const db = drizzle(sqlite, { schema });
