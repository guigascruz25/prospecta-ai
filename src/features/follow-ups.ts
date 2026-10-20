import { sqlite } from '../db';
import { env } from '../lib/config';
import { inOperatingHours } from '../lib/domain';
import { blocked,enqueue,event,getLead,listLeads,patchLead,setting } from './crm';

export const followUpsEnabled=()=>setting('follow_up_enabled')==='true';
export function nextOperatingAt(from:Date) {
  let timestamp=from.getTime();
  for(let minute=0;minute<2880;minute++,timestamp+=60000) if(inOperatingHours(new Date(timestamp),env.OPERATING_HOURS,env.OPERATING_TIMEZONE)) return new Date(timestamp).toISOString();
  throw new Error('Horário de operação inválido para retorno.');
}
export function unanswered(id:string) {
  const lead=getLead(id);
  return Boolean(lead && lead.purpose==='prospect' && lead.funnel==='customer' && lead.channel==='waiting_inbound_reply' && lead.stage!=='closed' && !lead.lastInboundAt && !blocked(lead.handle) && !sqlite.prepare("SELECT id FROM messages WHERE lead_id=? AND direction='inbound'").get(id));
}
export function cancelFollowUps(id:string,reason:string) {
  const lead=getLead(id);
  if(!lead || lead.followUpStatus==='not_scheduled' && !sqlite.prepare("SELECT id FROM jobs WHERE lead_id=? AND kind='follow_up'").get(id)) return;
  sqlite.prepare("UPDATE jobs SET status='cancelled' WHERE lead_id=? AND kind='follow_up' AND status='pending'").run(id);
  patchLead(id,{followUpStatus:'cancelled',followUpNextAt:''});
  event(id,'follow_ups_cancelled',reason);
}
export function scheduleNextFollowUp(id:string,from?:Date) {
  if(!followUpsEnabled() || !unanswered(id)) return false;
  const lead=getLead(id)!;
  if(lead.followUpCount>=3 || ['finished','cancelled','platform_blocked'].includes(lead.followUpStatus)) return false;
  if(sqlite.prepare("SELECT id FROM jobs WHERE lead_id=? AND kind='follow_up' AND status IN ('pending','processing')").get(id)) return false;
  const first=sqlite.prepare("SELECT created_at FROM messages WHERE lead_id=? AND direction='outbound' AND status='sent' AND channel=? ORDER BY created_at LIMIT 1").get(id,lead.mode==='live'?'browser':'simulation') as {created_at:string}|undefined;
  if(!first) return false;
  const previous=sqlite.prepare("SELECT messages.created_at FROM messages JOIN jobs ON jobs.idempotency_key=messages.idempotency_key WHERE messages.lead_id=? AND jobs.kind='follow_up' AND messages.status='sent' ORDER BY messages.created_at DESC LIMIT 1").get(id) as {created_at:string}|undefined;
  const anchor=from?.getTime() ?? Date.parse(previous?.created_at || first.created_at);
  // A delayed or restarted sequence never sends several overdue attempts together.
  const due=nextOperatingAt(new Date(Math.max(anchor+86400000,Date.now())));
  const step=lead.followUpCount+1;
  return sqlite.transaction(()=>{
    if(!followUpsEnabled() || !unanswered(id) || getLead(id)?.followUpCount!==lead.followUpCount || sqlite.prepare("SELECT id FROM jobs WHERE lead_id=? AND kind='follow_up' AND status IN ('pending','processing')").get(id)) return false;
    enqueue(id,'follow_up',`follow-up:${id}:${step}`,{step},0);
    sqlite.prepare("UPDATE jobs SET run_at=? WHERE idempotency_key=? AND status='pending'").run(due,`follow-up:${id}:${step}`);
    patchLead(id,{followUpStatus:'scheduled',followUpNextAt:due,nextAction:`Follow-up ${step}/3 agendado; cancelar se houver resposta`});
    event(id,'follow_up_scheduled',`Retorno ${step}/3 agendado para ${due}.`);
    return true;
  }).immediate();
}
export function scheduleUnansweredLeads() {
  if(!followUpsEnabled()) return 0;
  let scheduled=0;
  for(const lead of listLeads()) if(lead.mode==='live'&&scheduleNextFollowUp(lead.id)) scheduled++;
  return scheduled;
}
