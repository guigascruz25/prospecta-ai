import { randomUUID } from 'node:crypto';
import { sqlite } from '../db';
import { env, getBusiness, readiness } from '../lib/config';
import { normalizeText, inOperatingHours } from '../lib/domain';
import { addLead, blocked, event, listLeads, now, patchLead, requestContact, setSetting, setting, pause } from './crm';
import { instagramHandle, companyHandleMatchesName, searchBusinesses, type SearchBatch } from '../integrations/business-search';
import { inspectBusinessProfile } from '../integrations/browser';
import { geocodeAddress } from '../integrations/geocoding';
import { findWebsiteAddress } from '../integrations/public-website';
import { rampedDailyLimit } from '../lib/send-policy';
import {queueAutomaticWebhook} from './outbound-webhook';

export const captureSegments=['lojas de roupas e calçados','clínicas odontológicas e de estética','imobiliárias','lojas de móveis e decoração','oficinas e lojas de autopeças','academias','lojas de materiais de construção','pet shops e clínicas veterinárias'];
export const captureEnabled=()=>setting('capture_enabled')?setting('capture_enabled')==='true':env.CAPTURE_ENABLED==='true';
export const autoContactEnabled=()=>setting('capture_auto_contact')?setting('capture_auto_contact')==='true':env.CAPTURE_AUTO_CONTACT==='true';
export function localDay(value:string|Date) {return new Intl.DateTimeFormat('en-CA',{timeZone:env.OPERATING_TIMEZONE}).format(new Date(value));}
export function nextCaptureAt(from=new Date()) {
  let timestamp=from.getTime()+env.CAPTURE_INTERVAL_HOURS*3600000;
  for(let minute=0;minute<2880;minute++,timestamp+=60000) if(inOperatingHours(new Date(timestamp),env.OPERATING_HOURS,env.OPERATING_TIMEZONE)) return new Date(timestamp).toISOString();
  throw new Error('Horário de operação não permite uma nova rodada de captação.');
}
export function contactLimit() {
  const start=setting('live_started_at') || now();
  return rampedDailyLimit(env.MAX_DMS_PER_DAY,env.INITIAL_DMS_PER_DAY,start);
}
export function importedToday() {
  return (sqlite.prepare('SELECT created_at FROM lead_sources').all() as {created_at:string}[]).filter(item=>localDay(item.created_at)===localDay(new Date())).length;
}
export function captureStatus() {
  const runs=(sqlite.prepare('SELECT * FROM discovery_runs ORDER BY created_at DESC LIMIT 20').all() as DiscoveryRun[]).map(run=>({...run,queued:(sqlite.prepare("SELECT COUNT(DISTINCT jobs.lead_id) AS count FROM jobs JOIN lead_sources ON lead_sources.lead_id=jobs.lead_id WHERE lead_sources.run_id=? AND jobs.idempotency_key='first:' || jobs.lead_id").get(run.id) as {count:number}).count}));
  return {enabled:captureEnabled(),autoContact:autoContactEnabled(),intervalHours:env.CAPTURE_INTERVAL_HOURS,batchSize:env.CAPTURE_BATCH_SIZE,dailyLeadLimit:env.CAPTURE_MAX_NEW_LEADS_PER_DAY,importedToday:importedToday(),contactLimit:contactLimit(),nextRun:setting('capture_next_at'),requested:setting('capture_requested')==='true',runs,sources:sqlite.prepare("SELECT * FROM lead_sources WHERE verification_note NOT LIKE 'Descartado:%' ORDER BY created_at DESC LIMIT 100").all() as LeadSource[]};
}
export type DiscoveryRun={id:string;query:string;segment:string;status:string;found:number;added:number;queued:number;error:string|null;created_at:string;finished_at:string|null;sources_json:string;search_cost:number;candidates_json:string;rejection_notes:string;phase:string};
export type LeadSource={lead_id:string;run_id:string;source_url:string;locality_evidence:string;business_evidence:string;verified:number;verification_note:string;created_at:string;address:string;latitude:number|null;longitude:number|null;geocode_note:string;address_source_url:string};
export async function verifyDiscoveredLead(id:string, inspect=inspectBusinessProfile) {
  const source=sqlite.prepare('SELECT * FROM lead_sources WHERE lead_id=?').get(id) as LeadSource|undefined;
  const lead=listLeads().find(item=>item.id===id);
  if(!source || !lead || lead.mode!=='live' || blocked(lead.handle)) throw new Error('Selecione um perfil encontrado e permitido para contato.');
  const result=await inspect(lead.handle,getBusiness().GEOGRAPHY.split(',')[0].trim());
  sqlite.prepare('UPDATE lead_sources SET verified=?,verification_note=? WHERE lead_id=?').run(Number(result.verified),result.note,id);
  let address=result.address || source.address;
  if(result.verified && !address && inspect===inspectBusinessProfile) {
    try {const located=await findWebsiteAddress(source.source_url,getBusiness().GEOGRAPHY.split(',')[0].trim());address=located.address;if(address) sqlite.prepare('UPDATE lead_sources SET address_source_url=? WHERE lead_id=?').run(located.sourceUrl,id);} catch { /* Missing address never invents a map position. */ }
  }
  if(result.verified && address) {
    const location=await geocodeAddress(address,getBusiness().GEOGRAPHY.split(',')[0].trim());
    sqlite.prepare('UPDATE lead_sources SET address=?,latitude=?,longitude=?,geocode_note=? WHERE lead_id=?').run(address,location?.latitude || null,location?.longitude || null,location?.note || 'Endereço encontrado, mas ponto no mapa ainda não confirmado.',id);
  }
  if(lead.channel==='browser_contact_pending') patchLead(id,{nextAction:result.verified?'Perfil local conferido; pronto para abordagem de qualificação':result.note});
  event(id,'profile_checked',result.note);
  return result;
}
export async function importCandidates(runId:string,batch:SearchBatch,inspect=inspectBusinessProfile,limit=env.CAPTURE_BATCH_SIZE) {
  const business=getBusiness();
  const city=business.GEOGRAPHY.split(',')[0].trim();
  const sources=new Set(batch.sources.map(url=>url.replace(/\/$/,'')));
  const excluded=new Set(listLeads().map(lead=>lead.handle));
  excluded.add(business.INSTAGRAM_HANDLE.replace(/^@/,'').toLowerCase());
  let added=0;const rejected:string[]=[];
  for(const candidate of batch.candidates) {
    const handle=candidate.handle.toLowerCase();
    const reason=!candidate.isCompany?'Não identificado como empresa':blocked(handle)?'Perfil na lista de não contato':excluded.has(handle)?'Já existe no CRM':instagramHandle(candidate.profileUrl)!==handle?'URL do perfil não corresponde ao @':!companyHandleMatchesName(handle,candidate.name)?'Link social não corresponde ao nome da empresa':!sources.has(candidate.sourceUrl.replace(/\/$/,''))?'Fonte não consta nas páginas pesquisadas':normalizeText(candidate.city)!==normalizeText(city)?'Cidade fora da região':!normalizeText(candidate.localityEvidence).includes(normalizeText(city))?'Trecho da fonte sem confirmação de cidade':added>=limit?'Limite desta rodada atingido':'';
    if(reason) {rejected.push(`${candidate.name}: ${reason}.`);continue;}
    const lead=sqlite.transaction(()=>{
      const created=addLead({handle,name:candidate.name,niche:candidate.niche,city,bio:candidate.businessEvidence,mode:'live',monthlyRevenue:null});
      sqlite.prepare('INSERT INTO lead_sources (lead_id,run_id,source_url,locality_evidence,business_evidence,verified,verification_note,created_at) VALUES (?,?,?,?,?,?,?,?)').run(created.id,runId,candidate.sourceUrl,candidate.localityEvidence,candidate.businessEvidence,0,'Perfil aguardando conferência',now());
      if(candidate.address) sqlite.prepare('UPDATE lead_sources SET address=? WHERE lead_id=?').run(candidate.address,created.id);
      event(created.id,'company_found',`Empresa encontrada por pesquisa web em ${city}. Fonte registrada; faturamento desconhecido.`);
      return created;
    })();
    excluded.add(handle);added++;
    sqlite.prepare('UPDATE discovery_runs SET added=? WHERE id=?').run(added,runId);
    try {await verifyDiscoveredLead(lead.id,inspect);} catch {
      sqlite.prepare('UPDATE lead_sources SET verification_note=? WHERE lead_id=?').run('Não foi possível conferir o perfil no Chrome. Refaça a conferência antes de abordar.',lead.id);
      patchLead(lead.id,{nextAction:'Conferência do perfil pendente; abordagem bloqueada'});
    }
    queueAutomaticWebhook(lead.id);
  }
  sqlite.prepare('UPDATE discovery_runs SET rejection_notes=? WHERE id=?').run(JSON.stringify(rejected),runId);
  return added;
}
export function queueVerifiedProspects() {
  if(!captureEnabled() || !autoContactEnabled() || setting('paused')!=='false' || env.APP_MODE!=='live' || !Object.values(readiness()).every(Boolean) || !inOperatingHours(new Date(),env.OPERATING_HOURS,env.OPERATING_TIMEZONE)) return 0;
  const sent=(sqlite.prepare("SELECT messages.created_at FROM messages JOIN leads ON leads.id=messages.lead_id WHERE leads.mode='live' AND messages.channel='browser' AND messages.status IN ('sent','reserved','uncertain')").all() as {created_at:string}[]).filter(row=>localDay(row.created_at)===localDay(new Date())).length;
  const pending=(sqlite.prepare("SELECT DISTINCT jobs.lead_id FROM jobs JOIN leads ON leads.id=jobs.lead_id WHERE leads.mode='live' AND jobs.kind='first_contact' AND jobs.status IN ('pending','processing')").all()).length;
  let slots=Math.max(0,contactLimit()-sent-pending);
  let queued=0;
  const verified=new Set((sqlite.prepare("SELECT lead_sources.lead_id FROM lead_sources JOIN discovery_runs ON discovery_runs.id=lead_sources.run_id WHERE lead_sources.verified=1 AND discovery_runs.status='completed'").all() as {lead_id:string}[]).map(row=>row.lead_id));
  for(const lead of listLeads().reverse()) {
    if(slots<=0) break;
    if(lead.mode!=='live' || lead.purpose!=='prospect' || lead.funnel!=='customer' || lead.channel!=='browser_contact_pending' || lead.stage==='closed' || !verified.has(lead.id) || blocked(lead.handle) || sqlite.prepare("SELECT id FROM jobs WHERE idempotency_key=?").get(`first:${lead.id}`)) continue;
    if(lead.monthlyRevenue!==null && lead.monthlyRevenue<=getBusiness().MIN_MONTHLY_REVENUE || lead.revenueStatus==='not_qualified') continue;
    requestContact(lead.id);slots--;queued++;
  }
  return queued;
}
export async function runCapture(options:{search?:typeof searchBusinesses;inspect?:typeof inspectBusinessProfile;allowPaused?:boolean}={}) {
  if(env.APP_MODE!=='live' || !readiness().openai) throw new Error('A captação requer modo real e OpenAI configurada.');
  if(!options.allowPaused && setting('paused')!=='false') return null;
  const limit=Math.min(env.CAPTURE_BATCH_SIZE,env.CAPTURE_MAX_NEW_LEADS_PER_DAY-importedToday());
  if(limit<=0) {setSetting('capture_next_at',nextCaptureAt());setSetting('capture_requested','false');return null;}
  const city=getBusiness().GEOGRAPHY.split(',')[0].trim();
  if(!city) throw new Error('Defina a cidade prioritária.');
  const index=Number(setting('capture_segment_index') || 0)%captureSegments.length;
  const segment=captureSegments[index];
  const id=randomUUID();
  const claimed=sqlite.transaction(()=>{
    if(sqlite.prepare("SELECT id FROM discovery_runs WHERE status='processing'").get()) return false;
    sqlite.prepare('INSERT INTO discovery_runs (id,query,segment,status,created_at) VALUES (?,?,?,?,?)').run(id,`${segment} em ${city}`,segment,'processing',now());
    setSetting('capture_requested','false');setSetting('capture_segment_index',String(index+1));
    setSetting('capture_next_at',nextCaptureAt());
    return true;
  }).immediate();
  if(!claimed) return null;
  try {
    const batch=await (options.search || searchBusinesses)(city,segment,listLeads().map(lead=>lead.handle),limit);
    sqlite.prepare("UPDATE discovery_runs SET sources_json=?,search_cost=?,candidates_json=?,found=?,phase='profiles' WHERE id=?").run(JSON.stringify(batch.sources),batch.cost,JSON.stringify(batch.candidates),batch.candidates.length,id);
    const added=await importCandidates(id,batch,options.inspect || inspectBusinessProfile,limit);
    sqlite.prepare("UPDATE discovery_runs SET status='completed',phase='completed',found=?,added=?,finished_at=? WHERE id=?").run(batch.candidates.length,added,now(),id);
    const queued=options.allowPaused?0:queueVerifiedProspects();
    sqlite.prepare('UPDATE discovery_runs SET queued=? WHERE id=?').run(queued,id);
    event(null,'capture_completed',`Captação em ${city}: ${added} empresas adicionadas; ${queued} abordagens na fila.`);
    return {id,found:batch.candidates.length,added,queued,cost:batch.cost};
  } catch(error) {
    const message=error instanceof Error?error.message.replaceAll(env.OPENAI_API_KEY || '\u0000','[segredo oculto]').replace(/sk-[A-Za-z0-9_-]+/g,'[segredo oculto]').slice(0,500):'Falha na pesquisa web.';
    sqlite.prepare("UPDATE discovery_runs SET status='failed',error=?,finished_at=? WHERE id=?").run(message,now(),id);
    event(null,'capture_failed',message);
    if(/Orçamento/.test(message)) pause(message);
    return {id,error:message};
  }
}
export function recoverCapture() {
  sqlite.prepare("UPDATE discovery_runs SET status='interrupted',error='Pesquisa interrompida; a próxima rodada seguirá o horário registrado.',finished_at=? WHERE status='processing'").run(now());
}
