import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {parse} from 'dotenv';

process.env.DATABASE_URL=`data/integration-test-${randomUUID()}.db`;
process.env.APP_MODE='simulation';process.env.ALLOW_LIVE_SENDS='false';
const {env}=await import('../src/lib/config');
const {saveIntegrationSettings,maskIntegrationSettings,validateWebhookUrl}=await import('../src/features/integration-settings');
const {sqlite}=await import('../src/db');
const {webhookPayload,deliverWebhook,queueAutomaticWebhook,processAutomaticWebhooks,recoverOutboundWebhooks}=await import('../src/features/outbound-webhook');
const original={...env};
after(()=>{Object.assign(env,original);sqlite.close();for(const suffix of ['','-wal','-shm'])try{unlinkSync(process.env.DATABASE_URL!+suffix);}catch{}});
function fixture(run:(root:string)=>void){const root=mkdtempSync(path.join(tmpdir(),'prospecta-integration-'));try{run(root);}finally{assert.equal(path.dirname(path.resolve(root)),path.resolve(tmpdir()));assert(path.basename(root).startsWith('prospecta-integration-'));rmSync(root,{recursive:true,force:true});}}
test('manual settings preserve existing secrets, comments, unrelated flags and reject writes outside the section',()=>fixture(root=>{
  const target=path.join(root,'.env');writeFileSync(target,'# Keep comment\nOPENAI_API_KEY=private-fixture\nAPP_MODE=simulation\nALLOW_LIVE_SENDS=false\nOTHER_VALUE=untouched\n');
  saveIntegrationSettings('openai',{OPENAI_API_KEY:'',OPENAI_MODEL:'my-model'},[],root);
  const result=readFileSync(target,'utf8');assert(result.includes('# Keep comment'));const values=parse(result);assert.equal(values.OPENAI_API_KEY,'private-fixture');assert.equal(values.OTHER_VALUE,'untouched');assert.equal(values.APP_MODE,'simulation');assert.equal(values.ALLOW_LIVE_SENDS,'false');assert.equal(values.OPENAI_MODEL,'my-model');
  assert.throws(()=>saveIntegrationSettings('openai',{ALLOW_LIVE_SENDS:'true'},[],root),/permitido/);
  assert.throws(()=>saveIntegrationSettings('openai',{OPENAI_API_KEY:'value\nALLOW_LIVE_SENDS=true'},[],root),/Confira/);
  assert.equal(readFileSync(target,'utf8'),result);
  saveIntegrationSettings('openai',{},['OPENAI_API_KEY'],root);assert.equal(parse(readFileSync(target,'utf8')).OPENAI_API_KEY,'');
}));
test('secret projection never returns stored keys, tokens, webhook path or auth value',()=>{
  const view=maskIntegrationSettings({...env,OPENAI_API_KEY:'private-fixture',INSTAGRAM_PAGE_ACCESS_TOKEN:'private-meta-token',OUTBOUND_WEBHOOK_URL:'https://receiver.example/secret-endpoint',OUTBOUND_WEBHOOK_HEADER_VALUE:'Bearer private-header'});
  const json=JSON.stringify(view);for(const value of ['private-fixture','private-meta-token','secret-endpoint','private-header'])assert(!json.includes(value));assert.equal(view.configured.OPENAI_API_KEY,true);assert.equal(view.webhookHost,'receiver.example');
});
test('webhook configuration rejects credentials, non-HTTPS, reserved headers and unconfirmed enablement',()=>fixture(root=>{
  assert.throws(()=>validateWebhookUrl('http://localhost:3000/hook'));
  assert.throws(()=>validateWebhookUrl('https://127.0.0.1/hook'));
  assert.throws(()=>validateWebhookUrl('https://192.168.1.10/hook'));
  assert.throws(()=>validateWebhookUrl('https://user:password@example.com/hook'));
  assert.throws(()=>saveIntegrationSettings('webhook',{OUTBOUND_WEBHOOK_URL:'https://receiver.example/hook',OUTBOUND_WEBHOOK_ENABLED:'true'},[],root),/Confirme/);
  assert.throws(()=>saveIntegrationSettings('webhook',{OUTBOUND_WEBHOOK_HEADER_NAME:'Host'},[],root),/cabeçalho/);
  assert.equal(validateWebhookUrl('https://hooks.other-platform.example/lead').hostname,'hooks.other-platform.example');
}));
function configure(){Object.assign(env,{OUTBOUND_WEBHOOK_URL:'https://receiver.example/hook',OUTBOUND_WEBHOOK_ENABLED:'true',OUTBOUND_WEBHOOK_AUTO_EXPORT:'false',OUTBOUND_WEBHOOK_RESEARCH_ONLY_CONFIRMED:'true',OUTBOUND_WEBHOOK_HEADER_NAME:'Authorization',OUTBOUND_WEBHOOK_HEADER_VALUE:'Bearer mock-header'});}
function lead(){const id=randomUUID();sqlite.prepare('INSERT INTO leads (id,handle,name,bio,niche,city,mode,funnel,stage,channel,score,variant,next_action,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,`fixture.${id.slice(0,8)}`,'Empresa fictícia','Contexto público','Serviços','Cidade de exemplo','live','customer','discovered','browser_contact_pending',40,'A','Confirmar contexto',new Date().toISOString(),new Date().toISOString());return id;}
test('payload does not invent contact details and delivery is idempotent across concurrent requests',async()=>{
  configure();const id=lead();const payload=webhookPayload(id);assert.equal(payload.phone,'');assert.equal(payload.allow_contact,false);assert.equal(payload.research.monthly_revenue,null); // Revenue stays unknown.
  let calls=0;const transport=async(_url:string,body:string,headers:Record<string,string>)=>{calls++;assert.equal(JSON.parse(body).external_id,`prospecta:${id}`);assert.equal(headers.Authorization,'Bearer mock-header');assert(headers['Idempotency-Key']);await new Promise(resolve=>setTimeout(resolve,10));return {status:201};};
  const results=await Promise.allSettled([deliverWebhook(id,transport),deliverWebhook(id,transport)]);assert.equal(calls,1);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
});
test('unknown delivery is never retried automatically; startup recovery preserves uncertainty',async()=>{
  configure();const id=lead();let calls=0;
  const result=await deliverWebhook(id,async()=>{calls++;throw new Error('timeout');});assert.equal(result.status,'unknown');
  await assert.rejects(()=>deliverWebhook(id,async()=>{calls++;return {status:200};}),/tentativa/);assert.equal(calls,1);
  sqlite.prepare("UPDATE outbound_webhook_deliveries SET status='processing' WHERE id=?").run(result.id);recoverOutboundWebhooks();assert.equal((sqlite.prepare('SELECT status FROM outbound_webhook_deliveries WHERE id=?').get(result.id) as {status:string}).status,'unknown');
});
test('automatic export is opt-in, queues only future supplied IDs, and respects blocked leads',async()=>{
  configure();const id=lead();queueAutomaticWebhook(id);assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM outbound_webhook_deliveries WHERE lead_id=?').get(id) as {n:number}).n,0);
  env.OUTBOUND_WEBHOOK_AUTO_EXPORT='true';queueAutomaticWebhook(id);assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM outbound_webhook_deliveries WHERE lead_id=?').get(id) as {n:number}).n,1);
  env.OUTBOUND_WEBHOOK_AUTO_EXPORT='false';await processAutomaticWebhooks();assert.equal((sqlite.prepare('SELECT status FROM outbound_webhook_deliveries WHERE lead_id=?').get(id) as {status:string}).status,'pending');
  const blockedId=lead();const handle=(sqlite.prepare('SELECT handle FROM leads WHERE id=?').get(blockedId) as {handle:string}).handle;sqlite.prepare('INSERT INTO do_not_contact VALUES (?,?,?)').run(handle,'Pedido de parada',new Date().toISOString());await assert.rejects(()=>deliverWebhook(blockedId,async()=>({status:200})),/não receber/);
});
