import {createHash,randomUUID} from 'node:crypto';
import {sqlite} from '../db';
import {env} from '../lib/config';
import {getLead,event,blocked} from './crm';
import {postPublicWebhook} from '../integrations/outbound-http';
import {validateWebhookUrl} from './integration-settings';

const destination=()=>createHash('sha256').update(env.OUTBOUND_WEBHOOK_URL).digest('hex');
export function webhookPayload(id?:string) {
  if(!id)return {event:'connection.test',external_id:`prospecta:test:${randomUUID()}`,name:'Empresa fictícia — teste Prospecta AI',company:'Empresa fictícia — teste Prospecta AI',phone:'',email:'',instagram:'',website:'',city:'Cidade de exemplo',source:'Prospecta AI — teste de conexão',status:'research_only',allow_contact:false,auto_contact:false,is_test:true,notes:'Teste solicitado pelo operador. Dados fictícios; não abordar.',research:{overview:'Teste de integração com dados fictícios.'}};
  const lead=getLead(id);
  if(!lead||lead.mode!=='live'||lead.purpose==='pilot')throw new Error('Selecione um lead real de prospecção.');
  if(blocked(lead.handle))throw new Error('Este lead pediu para não receber contato e não será exportado.');
  const source=sqlite.prepare('SELECT * FROM lead_sources WHERE lead_id=?').get(id) as {source_url:string;business_evidence:string;locality_evidence:string;address:string;address_source_url:string;latitude:number|null;longitude:number|null;verified:number}|undefined;
  const notes=sqlite.prepare("SELECT detail FROM events WHERE lead_id=? AND kind='operator_note' ORDER BY created_at DESC LIMIT 10").all(id) as {detail:string}[];
  return {event:'lead.researched',external_id:`prospecta:${lead.id}`,name:lead.name,company:lead.name,phone:'',email:'',instagram:`https://www.instagram.com/${lead.handle}/`,website:source?.source_url||'',city:lead.city,source:'Prospecta AI — pesquisa comercial',status:'research_only',allow_contact:false,auto_contact:false,is_test:false,notes:[`Empresa: ${lead.name}`,`Segmento: ${lead.niche}`,`Contexto: ${source?.business_evidence||lead.bio}`,`Fonte: ${source?.source_url||'Pesquisa externa não informada'}`,...notes.map(note=>note.detail),'Cadastro de dados; sem autorização de abordagem pelo webhook.'].join('\n\n'),research:{segment:lead.niche,overview:lead.bio,source_url:source?.source_url||'',locality_evidence:source?.locality_evidence||'',address:source?.address||'',address_source_url:source?.address_source_url||'',latitude:source?.latitude??null,longitude:source?.longitude??null,profile_verified:Boolean(source?.verified),monthly_revenue:lead.monthlyRevenue,revenue_status:lead.revenueStatus,crm_stage:lead.stage,next_action:lead.nextAction,meeting_format:lead.meetingFormat,meeting_preference:lead.meetingTime,updated_at:lead.updatedAt}};
}
export function webhookHistory() {
  return sqlite.prepare('SELECT d.id,d.kind,d.status,d.http_status,d.created_at,d.finished_at,l.name AS lead_name FROM outbound_webhook_deliveries d LEFT JOIN leads l ON l.id=d.lead_id ORDER BY d.created_at DESC LIMIT 20').all();
}
export function recoverOutboundWebhooks(){sqlite.prepare("UPDATE outbound_webhook_deliveries SET status='unknown',finished_at=? WHERE status='processing'").run(new Date().toISOString());}
export function queueAutomaticWebhook(id:string) {
  if(env.OUTBOUND_WEBHOOK_ENABLED!=='true'||env.OUTBOUND_WEBHOOK_AUTO_EXPORT!=='true'||env.OUTBOUND_WEBHOOK_RESEARCH_ONLY_CONFIRMED!=='true')return;
  const lead=getLead(id);
  if(!lead||lead.mode!=='live'||lead.purpose==='pilot'||blocked(lead.handle))return;
  sqlite.prepare('INSERT OR IGNORE INTO outbound_webhook_deliveries (id,destination,lead_id,kind,status,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(),destination(),id,'lead','pending',new Date().toISOString());
}
type Transport=(url:string,body:string,headers:Record<string,string>)=>Promise<{status:number}>;
export async function deliverWebhook(leadId?:string,transport:Transport=postPublicWebhook) {
  if(env.OUTBOUND_WEBHOOK_ENABLED!=='true'||!env.OUTBOUND_WEBHOOK_URL||env.OUTBOUND_WEBHOOK_RESEARCH_ONLY_CONFIRMED!=='true')throw new Error('Salve e habilite o webhook com a configuração do destino confirmada.');
  validateWebhookUrl(env.OUTBOUND_WEBHOOK_URL);
  const payload=webhookPayload(leadId);
  const kind=leadId?'lead':'test';
  const dest=destination();
  const deliveryId=sqlite.transaction(()=>{
    if(leadId){
      const existing=sqlite.prepare('SELECT id,status FROM outbound_webhook_deliveries WHERE destination=? AND lead_id=? AND kind=?').get(dest,leadId,kind) as {id:string;status:string}|undefined;
      if(existing){if(existing.status!=='pending')throw new Error('Este lead já teve uma tentativa neste destino. Confira o histórico e o CRM para evitar duplicação.');sqlite.prepare("UPDATE outbound_webhook_deliveries SET status='processing' WHERE id=?").run(existing.id);return existing.id;}
    }
    const id=randomUUID();
    sqlite.prepare('INSERT INTO outbound_webhook_deliveries (id,destination,lead_id,kind,status,created_at) VALUES (?,?,?,?,?,?)').run(id,dest,leadId||null,kind,'processing',new Date().toISOString());
    return id;
  }).immediate();
  let outcome='unknown',httpStatus:number|null=null;
  try {
    const headers:Record<string,string>={'Idempotency-Key':createHash('sha256').update(`${dest}:${leadId||deliveryId}`).digest('hex')};
    if(env.OUTBOUND_WEBHOOK_HEADER_VALUE)headers[env.OUTBOUND_WEBHOOK_HEADER_NAME]=env.OUTBOUND_WEBHOOK_HEADER_VALUE;
    const response=await transport(env.OUTBOUND_WEBHOOK_URL,JSON.stringify(payload),headers);
    httpStatus=response.status;outcome=response.status>=200&&response.status<300?'accepted':'rejected';
  } catch { /* The receiver may have processed a timed out request; no automatic retry. */ }
  sqlite.prepare('UPDATE outbound_webhook_deliveries SET status=?,http_status=?,finished_at=? WHERE id=?').run(outcome,httpStatus,new Date().toISOString(),deliveryId);
  event(leadId||null,'outbound_webhook',`Webhook: ${outcome==='accepted'?'HTTP aceito; confira o cadastro no destino':outcome==='rejected'?'HTTP rejeitado':'entrega não confirmada; conferir antes de repetir'}.`);
  return {id:deliveryId,status:outcome,httpStatus};
}
export async function processAutomaticWebhooks() {
  if(env.OUTBOUND_WEBHOOK_ENABLED!=='true'||env.OUTBOUND_WEBHOOK_AUTO_EXPORT!=='true')return;
  const next=sqlite.prepare("SELECT id,lead_id FROM outbound_webhook_deliveries WHERE status='pending' AND destination=? ORDER BY created_at LIMIT 1").get(destination()) as {id:string;lead_id:string}|undefined;
  if(!next)return;
  try {await deliverWebhook(next.lead_id);} catch {sqlite.prepare("UPDATE outbound_webhook_deliveries SET status='cancelled',finished_at=? WHERE id=? AND status='pending'").run(new Date().toISOString(),next.id);}
}
