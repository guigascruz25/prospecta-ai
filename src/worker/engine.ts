import { randomUUID } from 'node:crypto';
import { sqlite } from '../db';
import { getBusiness, env, readiness } from '../lib/config';
import { apiWindowOpen, inOperatingHours } from '../lib/domain';
import { blocked, getLead, patchLead, event, enqueue, receiveInbound, optOut, exception, pause, setting, setSetting, now } from '../features/crm';
import { sendBrowserMessage,MessageRequestPendingError,MessageComposerUnavailableError } from '../integrations/browser';
import { graph } from '../integrations/instagram';
import { decide, approvedReply, guardCustomerAction, type Decision } from '../integrations/openai';
import { revenueFromAnswer, meetingFormatFromAnswer, meetingTimeFromAnswer } from '../lib/qualification';
import type { Lead } from '../db/schema';
import { openingCopy,followUpCopy } from '../lib/outreach';
import { cancelFollowUps,followUpsEnabled,nextOperatingAt,unanswered } from '../features/follow-ups';
import { pollInstagramInbox } from '../integrations/instagram-polling';
import { rampedDailyLimit } from '../lib/send-policy';

export type Job = { id: string; lead_id: string; kind: string; payload: string; attempts: number; idempotency_key: string };
export function firstContactCopy(lead:Lead) {
  return openingCopy(lead,getBusiness());
}
function ensureSendAllowed(id: string, channel: 'browser' | 'api') {
  const lead = getLead(id);
  if (!lead || blocked(lead.handle) || lead.channel === 'do_not_contact') throw new Error('Lead bloqueado para contato.');
  if (setting('paused') !== 'false') throw new Error('Sistema pausado.');
  if (channel === 'browser' && lead.channel !== 'browser_contact_pending') throw new Error('Canal de navegador indisponível: handoff ou envio já realizado.');
  if (channel === 'api' && !['api_eligible','api_active'].includes(lead.channel)) throw new Error('Propriedade do canal não pertence à API.');
  if (channel === 'api' && !apiWindowOpen(lead.lastInboundAt)) { patchLead(id,{channel:'api_window_closed'}); throw new Error('Janela de atendimento expirada.'); }
  if (lead.mode === 'live' && !Object.values(readiness()).every(Boolean)) throw new Error('Integrações reais incompletas ou envio desativado.');
  return lead;
}
function reserveMessage(job: Job, text: string, channel: string) {
  return Boolean(sqlite.prepare('INSERT OR IGNORE INTO messages VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),job.lead_id,'outbound',channel,text,'reserved',job.idempotency_key,null,now()).changes);
}
function completeMessage(job: Job, externalId: string | null = null) { sqlite.prepare("UPDATE messages SET status='sent',external_id=? WHERE idempotency_key=?").run(externalId,job.idempotency_key); }
class FollowUpCancelled extends Error {}
function deferFollowUp(job:Job,due:string) {
  sqlite.prepare("UPDATE jobs SET status='pending',run_at=?,locked_at=NULL WHERE id=?").run(due,job.id);
  patchLead(job.lead_id,{followUpNextAt:due});
  return 'deferred' as const;
}
function ensureFollowUpAllowed(job:Job,step:number) {
  const lead=getLead(job.lead_id);
  if(!followUpsEnabled() || setting('paused')!=='false' || !unanswered(job.lead_id) || !lead || lead.followUpStatus!=='scheduled' || lead.followUpCount+1!==step) throw new FollowUpCancelled('Retorno cancelado porque a conversa mudou.');
  if(lead.mode==='live'&&!Object.values(readiness()).every(Boolean)) throw new Error('Integrações reais incompletas para retorno.');
  return lead;
}
export async function processFollowUp(job:Job,deps:{poll?:typeof pollInstagramInbox;send?:typeof sendBrowserMessage}={}) {
  const payload=JSON.parse(job.payload) as {step?:number};
  const step=payload.step;
  if(!step || !Number.isInteger(step) || step<1 || step>3) throw new Error('Retorno fora da sequência autorizada.');
  if(!followUpsEnabled() || setting('paused')!=='false') return deferFollowUp(job,nextOperatingAt(new Date(Date.now()+3600000)));
  if(!unanswered(job.lead_id)) {cancelFollowUps(job.lead_id,'Conversa respondida ou encerrada; retorno não enviado.');sqlite.prepare("UPDATE jobs SET status='cancelled' WHERE id=?").run(job.id);return;}
  const current=getLead(job.lead_id)!;
  if(current.followUpCount+1!==step || current.followUpStatus!=='scheduled') {sqlite.prepare("UPDATE jobs SET status='cancelled' WHERE id=?").run(job.id);return;}
  const lead=ensureFollowUpAllowed(job,step);
  if(lead.mode==='live') {
    if(env.INSTAGRAM_INBOUND_MODE==='polling') await (deps.poll || pollInstagramInbox)();
    if(!unanswered(lead.id)) {cancelFollowUps(lead.id,'Resposta encontrada antes do retorno; envio cancelado.');sqlite.prepare("UPDATE jobs SET status='cancelled' WHERE id=?").run(job.id);return;}
    if(!inOperatingHours(new Date(),env.OPERATING_HOURS,env.OPERATING_TIMEZONE)) return deferFollowUp(job,nextOperatingAt(new Date()));
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:env.OPERATING_TIMEZONE}).format(new Date());
    const sent=sqlite.prepare("SELECT messages.created_at FROM messages JOIN leads ON leads.id=messages.lead_id WHERE messages.channel='browser' AND messages.status IN ('sent','reserved','uncertain') AND leads.mode='live'").all() as {created_at:string}[];
    const count=sent.filter(row=>new Intl.DateTimeFormat('en-CA',{timeZone:env.OPERATING_TIMEZONE}).format(new Date(row.created_at))===today).length;
    if(count>=rampedDailyLimit(env.MAX_DMS_PER_DAY,env.INITIAL_DMS_PER_DAY,setting('live_started_at') || now())) return deferFollowUp(job,nextOperatingAt(new Date(Date.now()+86400000)));
    const earliest=Date.parse(setting('last_browser_send') || '2000-01-01')+env.MIN_SECONDS_BETWEEN_DMS*1000;
    if(earliest>Date.now()) return deferFollowUp(job,nextOperatingAt(new Date(earliest)));
  }
  const text=followUpCopy(step,getBusiness(),lead.name);
  try {
    if(lead.mode==='live') {
      await (deps.send || sendBrowserMessage)(lead.handle,text,job.id,false,async()=>{
        if(env.INSTAGRAM_INBOUND_MODE==='polling') await (deps.poll || pollInstagramInbox)();
        ensureFollowUpAllowed(job,step);
        if(!reserveMessage(job,text,'browser')) throw new Error('Retorno já reservado; confira antes de reenviar.');
      },true);
      setSetting('last_browser_send',now());
    } else {
      ensureFollowUpAllowed(job,step);
      if(!reserveMessage(job,text,'simulation')) throw new Error('Retorno simulado já reservado.');
    }
  } catch(error) {
    if(error instanceof FollowUpCancelled) {
      if(unanswered(lead.id) && (setting('paused')!=='false' || !followUpsEnabled())) return deferFollowUp(job,nextOperatingAt(new Date(Date.now()+3600000)));
      sqlite.prepare("UPDATE jobs SET status='cancelled' WHERE id=?").run(job.id);
      cancelFollowUps(lead.id,'Conversa mudou durante a preparação; retorno não enviado.');
      return;
    }
    if(error instanceof MessageRequestPendingError) {
      patchLead(lead.id,{followUpStatus:'platform_blocked',followUpNextAt:'',nextAction:'Instagram aguarda aceitação da solicitação; follow-ups impedidos'});
      event(lead.id,'follow_up_blocked','Retorno não enviado: o Instagram ainda não permite outra mensagem nesta conversa.');
      sqlite.prepare("UPDATE jobs SET status='cancelled',error='Instagram aguarda aceitação da solicitação; mensagem não enviada.' WHERE id=?").run(job.id);
      return;
    }
    throw error;
  }
  sqlite.transaction(()=>{
    completeMessage(job);
    const stillUnanswered=unanswered(lead.id);
    patchLead(lead.id,{followUpCount:step,followUpNextAt:'',followUpStatus:stillUnanswered?step===3?'finished':'scheduled':'cancelled',...(stillUnanswered?{nextAction:step===3?'Sequência encerrada; sem novas tentativas, disponível se responder':'Aguardar resposta ou próximo follow-up'}:{})});
    if(step===3&&stillUnanswered) patchLead(lead.id,{stage:'closed'});
    event(lead.id,'follow_up_sent',`Retorno ${step}/3 ${lead.mode==='live'?'enviado':'simulado'}${step===3?'; tentativas encerradas, resposta tardia continua disponível':''}.`);
  })();
}
export async function processJob(job: Job,deps:{sendBrowser?:typeof sendBrowserMessage}={}) {
  const lead = getLead(job.lead_id);
  if (!lead) throw new Error('Lead não encontrado.');
  if (blocked(lead.handle)) return;
  const business = getBusiness();
  if(job.kind==='follow_up') return processFollowUp(job);
  if (job.kind === 'first_contact') {
    ensureSendAllowed(lead.id,'browser');
    if (lead.mode === 'live') {
      if (!inOperatingHours(new Date(),env.OPERATING_HOURS,env.OPERATING_TIMEZONE)) { enqueue(lead.id,'first_contact',`${job.idempotency_key}:window:${now().slice(0,13)}`,JSON.parse(job.payload),900); return; }
      const start = setting('live_started_at') || now();
      if (!setting('live_started_at')) setSetting('live_started_at',start);
      const limit = rampedDailyLimit(env.MAX_DMS_PER_DAY,env.INITIAL_DMS_PER_DAY,start);
      const today = new Intl.DateTimeFormat('en-CA',{timeZone:env.OPERATING_TIMEZONE}).format(new Date());
      const sends = sqlite.prepare("SELECT messages.created_at FROM messages JOIN leads ON leads.id=messages.lead_id WHERE messages.channel='browser' AND messages.status IN ('sent','reserved','uncertain') AND leads.mode='live'").all() as {created_at:string}[];
      const dayCount = sends.filter(row => new Intl.DateTimeFormat('en-CA',{timeZone:env.OPERATING_TIMEZONE}).format(new Date(row.created_at)) === today).length;
      if (dayCount >= limit) { enqueue(lead.id,'first_contact',`${job.idempotency_key}:daily:${today}`,JSON.parse(job.payload),86400); return; }
      if (Date.now()-Date.parse(setting('last_browser_send') || '2000-01-01') < env.MIN_SECONDS_BETWEEN_DMS*1000) { enqueue(lead.id,'first_contact',`${job.idempotency_key}:interval:${randomUUID()}`,JSON.parse(job.payload),env.MAX_SECONDS_BETWEEN_DMS); return; }
    }
    const payload=JSON.parse(job.payload) as {approvedOpening?:unknown};
    const approvedOpening=typeof payload.approvedOpening==='string'?payload.approvedOpening.trim():'';
    if(approvedOpening.length>600)throw new Error('Abertura aprovada excede o limite permitido.');
    const text = lead.purpose!=='pilot'&&approvedOpening ? approvedOpening : firstContactCopy(lead);
    if (lead.mode === 'live') {
      await (deps.sendBrowser || sendBrowserMessage)(lead.handle,text,job.id,false,() => {
        ensureSendAllowed(lead.id,'browser');
        if(!reserveMessage(job,text,'browser')) throw new Error('Mensagem já reservada. Revisão necessária para evitar duplicidade.');
      });
      setSetting('last_browser_send',now());
    } else if(!reserveMessage(job,text,'simulation')) throw new Error('Mensagem já reservada. Revisão necessária para evitar duplicidade.');
    sqlite.transaction(() => {
      completeMessage(job);
      if (getLead(lead.id)?.channel === 'browser_contact_pending') patchLead(lead.id,{stage:'contacted',channel:'waiting_inbound_reply',nextAction:'Aguardar resposta do lead'});
      event(lead.id,'first_contact_sent',lead.mode === 'simulation' ? `Primeiro contato simulado. Variante ${lead.variant}.` : `Primeiro contato enviado. Variante ${lead.variant}.`);
      if (lead.mode === 'simulation') enqueue(lead.id,'simulate_inbound',`demo-inbound:${lead.id}`,{},2);
    })();
    return;
  }
  if (job.kind === 'simulate_inbound') {
    if (lead.mode !== 'simulation') throw new Error('Resposta simulada não permitida para lead real.');
    receiveInbound(lead.id,`demo:${lead.id}`,'Tenho interesse. Pode me passar o WhatsApp?');
    return;
  }
  if (job.kind === 'reply') {
    ensureSendAllowed(lead.id,'api');
    const decision: Decision = lead.purpose === 'pilot' ? {intent:'asked_info',action:'present',claimIndex:-1,questionIndex:-1} : lead.mode === 'simulation' ? {intent:'wants_whatsapp',action: lead.funnel === 'affiliate' && !business.AFFILIATE_GROUP_LINK ? 'human' : 'handoff',claimIndex:-1,questionIndex:-1} : await decide(lead);
    // A newer inbound message owns the next response; discard decisions made from stale context.
    if (getLead(lead.id)?.lastInboundAt !== lead.lastInboundAt) return;
    const payload = JSON.parse(job.payload) as {inboundId?:string};
    const latest = sqlite.prepare("SELECT external_id FROM messages WHERE lead_id=? AND direction='inbound' ORDER BY created_at DESC,rowid DESC LIMIT 1").get(lead.id) as {external_id:string} | undefined;
    if (payload.inboundId && latest?.external_id !== payload.inboundId) return;
    let replyLead=lead;
    if(lead.funnel==='customer' && lead.purpose!=='pilot' && lead.mode==='live') {
      const incoming=sqlite.prepare("SELECT text,created_at FROM messages WHERE lead_id=? AND direction='inbound' ORDER BY created_at DESC,rowid DESC LIMIT 1").get(lead.id) as {text:string;created_at:string}|undefined;
      const previous=sqlite.prepare("SELECT text FROM messages WHERE lead_id=? AND direction='outbound' AND created_at<=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(lead.id,incoming?.created_at || now()) as {text:string}|undefined;
      const revenue=revenueFromAnswer(incoming?.text || '',previous?.text || '',business.MIN_MONTHLY_REVENUE);
      const format=meetingFormatFromAnswer(incoming?.text || '',previous?.text || '');
      if(revenue!=='unknown') {patchLead(lead.id,{revenueStatus:revenue,revenueEvidence:incoming?.text || ''});event(lead.id,'revenue_qualified',`Qualificação por declaração do lead: ${revenue==='qualified'?'acima do mínimo':'abaixo ou igual ao mínimo'}.`);}
      if(format && business.MEETING_FORMATS.includes(format)) patchLead(lead.id,{meetingFormat:format});
      const preferredTime=meetingTimeFromAnswer(incoming?.text || '',previous?.text || '');
      if(preferredTime) {patchLead(lead.id,{meetingTime:preferredTime});decision.meetingTimeQuote=preferredTime;}
      replyLead=getLead(lead.id)!;
      Object.assign(decision,guardCustomerAction(decision,replyLead,business.MIN_MONTHLY_REVENUE));
    }
    event(lead.id,'ai_decision',`${lead.purpose === 'pilot' ? 'Confirmação fixa do teste' : lead.mode === 'simulation' ? 'Decisão simulada' : 'Decisão da IA'}: ${decision.intent}; ação: ${decision.action}.`);
    if (decision.intent === 'opt_out' || decision.intent === 'not_interested' || decision.action === 'close') { optOut(lead.id,'Encerramento solicitado pelo lead.'); return; }
    if (decision.action === 'human') { patchLead(lead.id,{channel:'human_review_required',nextAction:'Revisar conversa'}); exception(lead.id,'Conversa precisa de atendimento humano ou configuração da oferta.'); return; }
    if (decision.action === 'wait') { patchLead(lead.id,{nextAction:'Aguardar nova resposta'}); return; }
    const text = lead.purpose === 'pilot' ? 'Conexão do Prospecta AI confirmada. Obrigado pelo teste!' : approvedReply(replyLead,decision);
    if (!reserveMessage(job,text,lead.mode === 'simulation' ? 'simulation' : 'api')) throw new Error('Mensagem já reservada. Revisão necessária para evitar duplicidade.');
    let externalId: string | null = null;
    if (lead.mode === 'live') {
      const current = ensureSendAllowed(lead.id,'api');
      if (!current.metaId) throw new Error('ID oficial da Meta não vinculado.');
      const response = await graph(`${env.INSTAGRAM_BUSINESS_ACCOUNT_ID}/messages`,{method:'POST',body:JSON.stringify({recipient:{id:current.metaId},message:{text}})});
      if (typeof response.message_id !== 'string') throw new Error('Envio sem confirmação da Meta.');
      externalId = response.message_id;
    }
    sqlite.transaction(() => {
      completeMessage(job,externalId);
      const phases:Record<string,string>={route:'contact',diagnose:'diagnosis',offer:'offer',qualify:'qualification',invite:'invitation',ask_time:'time',schedule:'complete'};
      if(lead.funnel==='customer' && lead.purpose!=='pilot' && phases[decision.action]) patchLead(lead.id,{conversationPhase:phases[decision.action]});
      patchLead(lead.id,lead.purpose === 'pilot' ? {channel:'human_review_required',stage:'closed',nextAction:'Teste de conexão concluído; sem continuação comercial'} : {channel:'api_active',stage:decision.action === 'handoff' ? lead.funnel === 'customer' ? 'whatsapp_handoff' : 'interested' : ['route','diagnose','offer'].includes(decision.action) ? 'replied' : 'interested',nextAction:decision.action === 'handoff' ? 'Confirmar conversão com o operador' : 'Aguardar resposta'});
      event(lead.id,'reply_sent',lead.mode === 'simulation' ? 'Resposta e encaminhamento simulados.' : 'Resposta enviada pela API oficial.');
      if(decision.action==='schedule') {patchLead(lead.id,{channel:'human_review_required',stage:'meeting_requested',nextAction:'Confirmar disponibilidade e apresentação com o lead'});exception(lead.id,`Apresentação ${replyLead.meetingFormat==='presential'?'presencial':'online'} solicitada: ${replyLead.meetingTime}. Confirme o horário com o lead.`);}
      if(decision.action==='disqualify') patchLead(lead.id,{channel:'human_review_required',stage:'closed',nextAction:'Fora do faturamento mínimo declarado; sem novos contatos automáticos'});
    })();
    return;
  }
  throw new Error('Tipo de job desconhecido.');
}
export async function tick(deps:{sendBrowser?:typeof sendBrowserMessage}={}) {
  setSetting('worker_heartbeat',now());
  if (setting('paused') !== 'false') return false;
  const job = sqlite.transaction(() => {
    const candidate = sqlite.prepare("SELECT * FROM jobs WHERE status='pending' AND run_at <= ? ORDER BY run_at LIMIT 1").get(now()) as Job | undefined;
    if (!candidate) return;
    sqlite.prepare("UPDATE jobs SET status='processing',locked_at=?,attempts=attempts+1 WHERE id=? AND status='pending'").run(now(),candidate.id);
    return candidate;
  })();
  if (!job) return false;
  try {
    const result=await processJob(job,deps);
    if(result!=='deferred') sqlite.prepare("UPDATE jobs SET status='completed' WHERE id=? AND status='processing'").run(job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/sk-[A-Za-z0-9_-]+/g,'[segredo oculto]') : 'Falha ao executar job.';
    sqlite.prepare("UPDATE jobs SET status='failed',error=? WHERE id=?").run(message.slice(0,500),job.id);
    sqlite.prepare("UPDATE messages SET status='uncertain' WHERE idempotency_key=? AND status='reserved'").run(job.idempotency_key);
    const current = getLead(job.lead_id);
    if (current && !['do_not_contact','api_window_closed'].includes(current.channel)) patchLead(job.lead_id,{channel:'human_review_required',nextAction:'Revisar falha antes de reenviar'});
    exception(job.lead_id,message.slice(0,500));
    if (current?.mode === 'live') {
      const preflight=error instanceof MessageComposerUnavailableError && !sqlite.prepare('SELECT id FROM messages WHERE idempotency_key=?').get(job.idempotency_key);
      const recentComposerFailures=(sqlite.prepare("SELECT COUNT(*) AS count FROM jobs WHERE status='failed' AND error LIKE 'Campo de mensagem não abriu%' AND locked_at>=?").get(new Date(Date.now()-15*60000).toISOString()) as {count:number}).count;
      if(!preflight || recentComposerFailures>=3) pause('Falha na operação real. Confira a fila de exceções antes de retomar.');
    }
  }
  return true;
}
export function recoverJobs() {
  const interrupted = sqlite.prepare("SELECT * FROM jobs WHERE status='processing'").all() as Job[];
  for (const job of interrupted) {
    const uncertain = Boolean(sqlite.prepare('SELECT id FROM messages WHERE idempotency_key=?').get(job.idempotency_key));
    sqlite.prepare('UPDATE jobs SET status=?,error=? WHERE id=?').run(uncertain ? 'failed' : 'pending',uncertain ? 'Envio interrompido: confira a conversa antes de reenviar.' : null,job.id);
    if (uncertain) { sqlite.prepare("UPDATE messages SET status='uncertain' WHERE idempotency_key=? AND status='reserved'").run(job.idempotency_key); patchLead(job.lead_id,{channel:'human_review_required'}); exception(job.lead_id,'Reinício durante envio. Reenvio automático bloqueado.'); pause('Envio interrompido. Revisão necessária.'); }
  }
}
export function optimize() {
  const variants = ['A','B'].map(variant => {
    const rows = sqlite.prepare("SELECT stage FROM leads WHERE mode='live' AND purpose='prospect' AND variant=? AND id IN (SELECT lead_id FROM messages WHERE direction='outbound' AND channel='browser' AND status='sent')").all(variant) as {stage:string}[];
    return {variant, n:rows.length, active:rows.filter(row => ['active_customer','generated_customer'].includes(row.stage)).length};
  });
  if (variants.some(value => value.n < 100)) return;
  const [a,b] = variants;
  const difference = a.active/a.n - b.active/b.n;
  const uncertainty = 1.96 * Math.sqrt((a.active/a.n)*(1-a.active/a.n)/a.n + (b.active/b.n)*(1-b.active/b.n)/b.n);
  if (Math.abs(difference) <= uncertainty || uncertainty === 0) return;
  const winner = difference > 0 ? a : b;
  const key = `comparison:${a.n}:${b.n}`;
  sqlite.prepare('INSERT OR IGNORE INTO strategies VALUES (?,?,?,?)').run(key,winner.variant,`Sugestão: variante ${winner.variant}, baseada em conversões finais; A n=${a.n}, B n=${b.n}. Revisão do operador necessária.`,now());
}
