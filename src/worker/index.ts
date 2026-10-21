import { randomUUID } from 'node:crypto';
import { mkdirSync,existsSync } from 'node:fs';
import { basename } from 'node:path';
import { env, readiness } from '../lib/config';
import { sqlite } from '../db';
import { setting, setSetting, exception, pause, event } from '../features/crm';
import { tick, recoverJobs, optimize } from './engine';
import { pollInstagramInbox } from '../integrations/instagram-polling';
import { captureEnabled, queueVerifiedProspects, recoverCapture, runCapture } from '../features/discovery';
import { inOperatingHours } from '../lib/domain';
import { scheduleUnansweredLeads } from '../features/follow-ups';

const owner = randomUUID();
function lease() {
  return sqlite.transaction(() => {
    const current = setting('worker_lease').split('|');
    let previousAlive = true;
    if (current[2]) { try { process.kill(Number(current[2]),0); } catch { previousAlive = false; } }
    if (current[0] && current[0] !== owner && Number(current[1]) > Date.now() && previousAlive) return false;
    setSetting('worker_lease',`${owner}|${Date.now()+60000}|${process.pid}`);
    return true;
  })();
}
async function main() {
  if (!lease()) throw new Error('Já existe um worker ativo.');
  recoverJobs();
  recoverCapture();
  const renew = setInterval(() => { if (!lease()) process.exit(1); setSetting('worker_heartbeat',new Date().toISOString()); },10000);
  let closing = false;
  process.on('SIGTERM',() => { closing = true; });
  process.on('SIGINT',() => { closing = true; });
  let lastBackup = 0;
  let nextPoll = 0;
  let pollFailures = 0;
  let captureTask:Promise<void>|undefined;
  try {
    console.log('Worker local iniciado. Envios reais dependem de configuração explícita.');
    while (!closing) {
      if(existsSync('updates/maintenance.json')){await new Promise(resolve=>setTimeout(resolve,1000));continue;}
      if (env.APP_MODE === 'live' && env.INSTAGRAM_INBOUND_MODE === 'polling' && readiness().meta && Date.now() >= nextPoll) {
        try { await pollInstagramInbox(); pollFailures = 0; }
        catch {
          pollFailures++;
          const reason = 'Não foi possível consultar respostas na API do Instagram. Confira o token e as permissões.';
          setSetting('instagram_poll_error', reason);
          if (pollFailures === 3) { exception(null, reason); pause(reason); }
        }
        nextPoll = Date.now() + env.INSTAGRAM_POLL_INTERVAL_SECONDS * 1000 * Math.min(10, Math.max(1, pollFailures));
      }
      if(env.APP_MODE==='live' && setting('paused')==='false' && captureEnabled() && readiness().openai && inOperatingHours(new Date(),env.OPERATING_HOURS,env.OPERATING_TIMEZONE)) {
        queueVerifiedProspects();
        if(!captureTask && (setting('capture_requested')==='true' || !setting('capture_next_at') || Date.parse(setting('capture_next_at'))<=Date.now())) {
          captureTask=runCapture().then(()=>{}).catch(()=>{
            setSetting('capture_next_at',new Date(Date.now()+env.CAPTURE_INTERVAL_HOURS*3600000).toISOString());
            event(null,'capture_failed','Não foi possível iniciar a captação. Confira a configuração.');
          }).finally(()=>{captureTask=undefined;});
        }
      }
      if(setting('paused')==='false') scheduleUnansweredLeads();
      await tick();
      if (Date.now()-lastBackup > 86400000) {
        mkdirSync('backups',{recursive:true});
        const databaseName = basename(env.DATABASE_URL.replace(/^file:/,'')).replace(/[^a-zA-Z0-9_-]/g,'_');
        await sqlite.backup(`backups/${databaseName}-${new Date().toISOString().slice(0,10)}.db`);
        lastBackup = Date.now();
        optimize();
      }
      await new Promise(resolve => setTimeout(resolve,1000));
    }
  } finally {await captureTask; clearInterval(renew); if (setting('worker_lease').startsWith(owner)) setSetting('worker_lease',''); sqlite.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Erro no worker.'); process.exitCode = 1; });
