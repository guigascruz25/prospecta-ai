import { mkdirSync } from 'node:fs';
import { sqlite } from '../src/db';
mkdirSync('backups',{recursive:true});
const path=`backups/manual-${new Date().toISOString().replace(/[:.]/g,'-')}.db`;
await sqlite.backup(path);
sqlite.close();
console.log(`Backup criado: ${path}`);
