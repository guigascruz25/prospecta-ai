import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '../src/lib/config';
const source=process.argv[2];
if (!source) throw new Error('Informe o backup: pnpm restore backups/arquivo.db');
const target=resolve(env.DATABASE_URL.replace(/^file:/,''));
const candidate=resolve(source);
if (candidate===target) throw new Error('Backup e banco atual não podem ser o mesmo arquivo.');
const check=new Database(candidate,{readonly:true,fileMustExist:true});
if (check.pragma('quick_check',{simple:true})!=='ok' || !check.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='leads'").get()) throw new Error('Backup inválido.');
check.close();
if (existsSync(target)) {
  const current=new Database(target,{readonly:true});
  const lease=(current.prepare("SELECT value FROM settings WHERE key='worker_lease'").get() as {value:string}|undefined)?.value;
  if (lease && Number(lease.split('|')[1]) > Date.now()) throw new Error('Pare o sistema e aguarde 60 segundos antes de restaurar.');
  mkdirSync('backups',{recursive:true});
  await current.backup(`backups/before-restore-${Date.now()}.db`);current.close();
}
// The operator must stop the app before running this script.
const maintenance=new Database(target);maintenance.pragma('wal_checkpoint(TRUNCATE)');maintenance.close();
copyFileSync(candidate,target);
const restored=new Database(target);
restored.prepare("UPDATE settings SET value='true' WHERE key='paused'").run();
restored.prepare("UPDATE settings SET value='' WHERE key='worker_lease'").run();
restored.close();
console.log('Backup restaurado. A fila permanece pausada. Inicie o sistema e confira o CRM.');
