import { randomUUID, createHash } from 'node:crypto';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db, sqlite } from '../db';
import { leads, type Lead } from '../db/schema';
import { getBusiness, env, readiness } from '../lib/config';
import { customerStages, affiliateStages, isOptOut, stageLabels } from '../lib/domain';
import { captureStatus } from './discovery';
import { cancelFollowUps } from './follow-ups';

export const now = () => new Date().toISOString();
export const leadInput = z.object({
  handle: z.string().trim().transform(value => value.replace(/^@/, '').toLowerCase()).pipe(z.string().regex(/^[a-z0-9._]{1,30}$/)),
  name: z.string().trim().min(1).max(200), bio: z.string().max(4000).default(''),
  niche: z.string().max(100).default(''), city: z.string().max(100).default(''),
  funnel: z.enum(['customer', 'affiliate']).default('customer'),
  purpose: z.enum(['prospect', 'pilot']).default('prospect'),
  monthlyRevenue: z.number().nonnegative().nullable().default(null), mode: z.enum(['simulation', 'live']).default('live')
});
export function setting(key: string) { return (sqlite.prepare('SELECT value FROM settings WHERE key=?').get(key) as {value: string} | undefined)?.value || ''; }
export function setSetting(key: string, value: string) { sqlite.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); }
export function event(leadId: string | null, kind: string, detail: string) { sqlite.prepare('INSERT INTO events VALUES (?,?,?,?,?)').run(randomUUID(), leadId, kind, detail, now()); }
export function getLead(id: string) { return db.select().from(leads).where(eq(leads.id, id)).get(); }
export function listLeads() { return db.select().from(leads).orderBy(desc(leads.createdAt)).all(); }
export function blocked(handle: string) { return Boolean(sqlite.prepare('SELECT handle FROM do_not_contact WHERE handle=?').get(handle)); }
export function addLead(input: unknown) {
  const value = leadInput.parse(input);
  if (blocked(value.handle)) throw new Error('Este perfil pediu para não receber contato.');
  const business = getBusiness();
  const profile = `${value.bio} ${value.niche}`.toLowerCase();
  const keywords = business.ICP_KEYWORDS.filter(word => profile.includes(word.toLowerCase()));
  const hasRevenue = value.monthlyRevenue !== null && value.monthlyRevenue > business.MIN_MONTHLY_REVENUE;
  const local = Boolean(value.city && value.city.toLowerCase().includes(business.GEOGRAPHY.split(',')[0].toLowerCase()));
  const score = Math.min(100, 20 + keywords.length * 10 + (hasRevenue ? 40 : 0) + (local ? 20 : 0));
  const variant = parseInt(createHash('sha256').update(value.handle).digest('hex').slice(0, 4), 16) % 2 ? 'A' : 'B';
  const created = { ...value, id: randomUUID(), stage: 'discovered', channel: 'browser_contact_pending', score, variant, metaId: null, lastInboundAt: null, nextAction: value.purpose === 'pilot' ? 'Conferir navegador e executar teste autorizado' : value.monthlyRevenue === null ? 'Confirmar faturamento e aderência ao público' : 'Qualificar perfil', createdAt: now(), updatedAt: now() };
  const inserted = db.insert(leads).values(created).onConflictDoNothing().returning().get();
  if (inserted) { event(inserted.id, 'lead_discovered', `Perfil cadastrado. Pontuação inicial: ${score}. Faturamento ${hasRevenue ? 'compatível' : 'a confirmar'}.`); return inserted; }
  return db.select().from(leads).where(eq(leads.handle, value.handle)).all().find(lead => lead.mode === value.mode)!;
}
export function patchLead(id: string, changes: Partial<Lead>) { db.update(leads).set({ ...changes, updatedAt: now() }).where(eq(leads.id, id)).run(); }
export function setStage(id: string, stage: string) {
  const lead = getLead(id);
  if (!lead) throw new Error('Lead não encontrado.');
  if (!(lead.funnel === 'customer' ? customerStages : affiliateStages).includes(stage)) throw new Error('Etapa inválida para este funil.');
  if (blocked(lead.handle) && stage !== 'closed') throw new Error('Perfil na lista de não contato.');
  sqlite.transaction(() => { patchLead(id, { stage }); event(id, 'stage_changed', `Etapa: ${stageLabels[stage]}. Atualização do operador.`); })();
}
export function optOut(id: string, reason: string) {
  const lead = getLead(id);
  if (!lead) throw new Error('Lead não encontrado.');
  sqlite.transaction(() => {
    sqlite.prepare('INSERT OR IGNORE INTO do_not_contact VALUES (?,?,?)').run(lead.handle, reason, now());
    sqlite.prepare("UPDATE leads SET channel='do_not_contact',stage='closed',next_action='Não contatar',updated_at=? WHERE handle=?").run(now(), lead.handle);
    sqlite.prepare("UPDATE jobs SET status='cancelled' WHERE lead_id IN (SELECT id FROM leads WHERE handle=?) AND status='pending'").run(lead.handle);
    event(id, 'opt_out', reason);
    cancelFollowUps(id,'Encerramento solicitado; nenhum novo retorno.');
  })();
}
export function enqueue(leadId: string, kind: string, key: string, payload: object = {}, delaySeconds = 0) {
  sqlite.prepare('INSERT OR IGNORE INTO jobs (id,lead_id,kind,payload,run_at,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(),leadId,kind,JSON.stringify(payload),new Date(Date.now()+delaySeconds*1000).toISOString(),key,now());
}
export function requestContact(id: string) {
  const lead = getLead(id);
  if (!lead || lead.channel !== 'browser_contact_pending' || blocked(lead.handle)) throw new Error('Este lead não pode receber primeiro contato.');
  if (lead.mode === 'live') {
    const ready = readiness();
    if (!Object.values(ready).every(Boolean)) throw new Error('Envio real desativado ou integrações não configuradas.');
    const business = getBusiness();
    if (lead.handle === business.INSTAGRAM_HANDLE.replace(/^@/,'').toLowerCase()) throw new Error('Use outra conta para receber o contato.');
    if (lead.purpose !== 'pilot' && lead.funnel === 'customer') {
      const localSource=sqlite.prepare('SELECT lead_id FROM lead_sources WHERE lead_id=? AND verified=1').get(lead.id);
      if(lead.revenueStatus==='not_qualified' || lead.monthlyRevenue!==null && lead.monthlyRevenue<=business.MIN_MONTHLY_REVENUE) throw new Error('Faturamento abaixo ou igual ao mínimo; abordagem indisponível.');
      if(lead.monthlyRevenue===null && lead.revenueStatus!=='qualified' && !localSource) throw new Error('Confirme faturamento acima do mínimo ou confira a fonte local antes de abordar para qualificação.');
    }
  }
  sqlite.transaction(() => {
    patchLead(id, { stage: 'qualified', nextAction: 'Primeiro contato na fila' });
    enqueue(id, 'first_contact', `first:${id}`);
    event(id, 'contact_queued', 'Primeiro contato agendado.');
  })();
}
export function pause(reason: string) { setSetting('paused', 'true'); setSetting('pause_reason', reason); event(null, 'system_paused', reason); }
export function exception(leadId: string | null, reason: string) { sqlite.prepare('INSERT INTO exceptions VALUES (?,?,?,?,?)').run(randomUUID(),leadId,reason,0,now()); event(leadId, 'exception', reason); }
export function receiveInbound(id: string, externalId: string, text: string, timestamp = now()) {
  const lead = getLead(id);
  if (!lead) throw new Error('Lead não encontrado.');
  return sqlite.transaction(() => {
    if (!sqlite.prepare('INSERT OR IGNORE INTO webhook_receipts VALUES (?,?)').run(externalId, now()).changes) return false;
    sqlite.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,'inbound',lead.mode === 'simulation' ? 'simulation' : 'api',text,'received',`inbound:${externalId}`,externalId,timestamp);
    event(id, 'inbound_received', 'Resposta recebida; propriedade do canal transferida à API.');
    cancelFollowUps(id,'Resposta recebida; sequência sem resposta interrompida.');
    if (isOptOut(text)) { optOut(id, 'Pedido de remoção recebido na conversa.'); return true; }
    if (blocked(lead.handle)) return true;
    if (lead.lastInboundAt && timestamp < lead.lastInboundAt) return true;
    if (lead.channel === 'human_review_required') {
      patchLead(id, { lastInboundAt: timestamp });
      return true;
    }
    patchLead(id, { channel: 'api_eligible', stage: 'replied', lastInboundAt: timestamp, nextAction: 'Interpretar e responder pela API' });
    sqlite.prepare("UPDATE jobs SET status='cancelled' WHERE lead_id=? AND kind IN ('first_contact','follow_up','reply') AND status='pending'").run(id);
    enqueue(id,'reply',`reply:${externalId}`,{ inboundId: externalId });
    return true;
  })();
}
export function demo() {
  if (env.APP_MODE !== 'simulation') throw new Error('A demonstração só roda em modo de simulação.');
  const examples = [
    { handle: 'demo.loja.local', name: 'Loja Horizonte • exemplo', bio: 'Loja de roupas e acessórios. Atendimento local.', niche: 'Varejo', funnel: 'customer' as const, monthlyRevenue: 85000 },
    { handle: 'demo.clinica.local', name: 'Clínica Bem • exemplo', bio: 'Clínica de estética com agenda de atendimento.', niche: 'Serviços', funnel: 'customer' as const, monthlyRevenue: 65000 },
    { handle: 'demo.criador.local', name: 'Criador local • exemplo', bio: 'Conteúdo sobre negócios e empreendedorismo.', niche: 'Criador', funnel: 'affiliate' as const, monthlyRevenue: null }
  ];
  for (const example of examples) {
    const lead = addLead({ ...example, city: getBusiness().GEOGRAPHY, mode: 'simulation' });
    if (lead.channel === 'browser_contact_pending') requestContact(lead.id);
  }
  setSetting('paused','false'); setSetting('pause_reason','');
  event(null, 'simulation_started', 'Demonstração iniciada. Nenhuma mensagem será enviada ao Instagram ou WhatsApp.');
}
export function snapshot() {
  const allLeads = listLeads();
  const month = now().slice(0,7);
  const cost = (sqlite.prepare('SELECT COALESCE(SUM(estimated_cost),0) as cost FROM ai_calls WHERE created_at LIKE ?').get(`${month}%`) as {cost:number}).cost;
  return {
    business: getBusiness(), leads: allLeads, capture: captureStatus(),
    followUps: {enabled:setting('follow_up_enabled')==='true',hours:[24,48,72]},
    messages: sqlite.prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT 300').all(),
    events: sqlite.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT 150').all(),
    jobs: sqlite.prepare('SELECT jobs.*, leads.name as lead_name, leads.mode as mode FROM jobs LEFT JOIN leads ON jobs.lead_id=leads.id ORDER BY created_at DESC LIMIT 100').all(),
    exceptions: sqlite.prepare('SELECT * FROM exceptions WHERE resolved=0 ORDER BY created_at DESC LIMIT 50').all(),
    strategies: sqlite.prepare('SELECT * FROM strategies ORDER BY created_at DESC LIMIT 20').all(),
    paused: setting('paused') !== 'false', pauseReason: setting('pause_reason'), heartbeat: setting('worker_heartbeat'), workerOnline: Boolean(setting('worker_heartbeat') && Date.now()-Date.parse(setting('worker_heartbeat')) < 15000),
    cost, budget: env.OPENAI_MONTHLY_BUDGET_USD, mode: env.APP_MODE, readiness: readiness(),
    instagramInbound: { mode: env.INSTAGRAM_INBOUND_MODE, intervalSeconds: env.INSTAGRAM_POLL_INTERVAL_SECONDS, lastCheck: setting('instagram_last_poll'), error: setting('instagram_poll_error') },
    limits: { daily: env.MAX_DMS_PER_DAY, interval: `${env.MIN_SECONDS_BETWEEN_DMS}–${env.MAX_SECONDS_BETWEEN_DMS}s`, hours: env.OPERATING_HOURS, timezone: env.OPERATING_TIMEZONE },
    costPerLead: allLeads.filter(lead => lead.mode === 'live' && lead.purpose !== 'pilot').length ? cost / allLeads.filter(lead => lead.mode === 'live' && lead.purpose !== 'pilot').length : 0,
    costPerCustomer: allLeads.filter(lead => lead.mode === 'live' && lead.stage === 'active_customer').length ? cost / allLeads.filter(lead => lead.mode === 'live' && lead.stage === 'active_customer').length : null
  };
}
