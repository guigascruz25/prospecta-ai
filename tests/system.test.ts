import type { Job } from '../src/worker/engine';
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHmac } from 'node:crypto';
import { mkdirSync,readFileSync,writeFileSync,unlinkSync } from 'node:fs';
import Database from 'better-sqlite3';

process.env.DATABASE_URL = `data/test-${randomUUID()}.db`;
process.env.BUSINESS_CONFIG_PATH = `config/test-business-${randomUUID()}.json`;
mkdirSync('data',{recursive:true});
writeFileSync(process.env.BUSINESS_CONFIG_PATH,JSON.stringify({...JSON.parse(readFileSync('config/business.example.json','utf8')),OWNER_NAME:'Responsável de teste',COMPANY_NAME:'Empresa de teste',PROJECT_NAME:'Vendus',INSTAGRAM_HANDLE:'@owner.test',WHATSAPP_LINK:'https://wa.me/5531999990000',ONE_LINE_PITCH:'Sistema de vendas',VERIFIED_CLAIMS:['O Vendus apoia o atendimento comercial.','O Vendus atende 24 horas por dia.'],ICP_KEYWORDS:['loja','serviços'],GEOGRAPHY:'Patos de Minas, MG',MIN_MONTHLY_REVENUE:50000,MEETING_FORMATS:['online','presential']}));
process.env.APP_MODE = 'simulation';
process.env.ALLOW_LIVE_SENDS = 'false';
Object.assign(process.env,{OPENAI_API_KEY:'test-placeholder',OPENAI_MODEL:'test-model',OPENAI_MODEL_FAST:'test-model',OPENAI_INPUT_USD_PER_MILLION:'1',OPENAI_OUTPUT_USD_PER_MILLION:'1',INSTAGRAM_PAGE_ACCESS_TOKEN:'test-placeholder',INSTAGRAM_BUSINESS_ACCOUNT_ID:'123456789',INSTAGRAM_SCOPED_ACCOUNT_ID:'',INSTAGRAM_GRAPH_VERSION:'v26.0',INSTAGRAM_INBOUND_MODE:'polling'});
globalThis.fetch=async()=>{throw new Error('Rede bloqueada nos testes locais; injete um provedor simulado.');};
const { sqlite } = await import('../src/db');
const crm = await import('../src/features/crm');
const engine = await import('../src/worker/engine');
const domain = await import('../src/lib/domain');
const { approvedReply,guardCustomerAction } = await import('../src/integrations/openai');
const { reserveBudget } = await import('../src/features/budget');
const { env } = await import('../src/lib/config');
const { validSignature } = await import('../src/integrations/instagram');
const { pollInstagramInbox } = await import('../src/integrations/instagram-polling');
const { revenueFromAnswer,meetingFormatFromAnswer,meetingTimeFromAnswer }=await import('../src/lib/qualification');
const { instagramHandle,companyHandleMatchesName,companyInstagramProfiles }=await import('../src/integrations/business-search');
const { importCandidates,queueVerifiedProspects,nextCaptureAt }=await import('../src/features/discovery');
const { profileEvidence }=await import('../src/integrations/browser');
const { locationFromResult }=await import('../src/integrations/geocoding');
const { publicAddress,instagramLinks }=await import('../src/integrations/public-website');
const followUps=await import('../src/features/follow-ups');
const {followUpCopy}=await import('../src/lib/outreach');
const {getBusiness}=await import('../src/lib/config');
const {MessageRequestPendingError,MessageComposerUnavailableError,pendingMessageRequest,instagramThreadUrl}=await import('../src/integrations/browser');

beforeEach(() => {
  for (const table of ['lead_sources','discovery_runs','strategies','exceptions','webhook_receipts','ai_calls','events','jobs','messages','do_not_contact','leads']) sqlite.prepare(`DELETE FROM ${table}`).run();
  crm.setSetting('paused','false');
  crm.setSetting('follow_up_enabled','false');
});
after(() => { sqlite.close();unlinkSync(process.env.BUSINESS_CONFIG_PATH!); });
const create = (handle = 'test.local', mode = 'simulation') => crm.addLead({handle,name:'Empresa de teste',bio:'Loja de serviços',city:'Patos de Minas',monthlyRevenue:60000,mode});
async function finishQueue() { for (let index=0; index<15; index++) { sqlite.prepare("UPDATE jobs SET run_at=? WHERE status='pending'").run(crm.now()); if (!await engine.tick()) break; } }

test('lead dedupe normalizes handles and preserves one record', () => {
  const a=create('@test.local'); const b=create('TEST.LOCAL'); assert.equal(a.id,b.id); assert.equal(crm.listLeads().length,1);
});
test('pipeline and channel are independent; funnel stages validated', () => {
  const lead=create(); crm.setStage(lead.id,'qualified'); assert.equal(crm.getLead(lead.id)?.channel,'browser_contact_pending');
  assert.throws(()=>crm.setStage(lead.id,'active_affiliate'));
});
test('full simulated contact -> inbound -> API handoff -> WhatsApp is durable and idempotent', async () => {
  const lead=create(); crm.requestContact(lead.id); await finishQueue();
  assert.equal(crm.getLead(lead.id)?.stage,'whatsapp_handoff');
  assert.equal(crm.getLead(lead.id)?.channel,'api_active');
  assert.equal(sqlite.prepare('SELECT * FROM messages WHERE lead_id=?').all(lead.id).length,3);
  assert.equal(sqlite.prepare('SELECT * FROM ai_calls').all().length,0);
  assert.throws(()=>crm.requestContact(lead.id));
  assert.equal(crm.receiveInbound(lead.id,`demo:${lead.id}`,'Outra vez'),false);
});
test('opt-out is permanent across campaigns and cancels pending jobs', () => {
  const lead=create();crm.requestContact(lead.id);crm.receiveInbound(lead.id,'opt-out','Não me envie mensagens');
  assert.equal(crm.getLead(lead.id)?.channel,'do_not_contact');
  assert.equal((sqlite.prepare('SELECT status FROM jobs WHERE lead_id=?').get(lead.id) as {status:string}).status,'cancelled');
  assert.throws(()=>create('test.local','live'));
});
test('API window expiration blocks sends and never returns to browser', async () => {
  const lead=create();crm.patchLead(lead.id,{channel:'api_eligible',lastInboundAt:new Date(Date.now()-25*3600000).toISOString()});
  crm.enqueue(lead.id,'reply','expired');await engine.tick();
  assert.equal(crm.getLead(lead.id)?.channel,'api_window_closed');assert.throws(()=>crm.requestContact(lead.id));
  assert.equal(sqlite.prepare('SELECT * FROM messages').all().length,0);
});
test('recovery blocks uncertain send retries after restart', () => {
  const lead=create();crm.enqueue(lead.id,'first_contact','uncertain');
  sqlite.prepare("UPDATE jobs SET status='processing'").run();
  sqlite.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),lead.id,'outbound','simulation','Oi','reserved','uncertain',null,crm.now());
  engine.recoverJobs();assert.equal(crm.setting('paused'),'true');
  assert.equal(crm.getLead(lead.id)?.channel,'human_review_required');
  assert.equal((sqlite.prepare('SELECT status FROM jobs').get() as {status:string}).status,'failed');
});
test('recovery reschedules jobs without a reserved outgoing message', () => {
  const lead=create();crm.enqueue(lead.id,'simulate_inbound','safe');sqlite.prepare("UPDATE jobs SET status='processing'").run();engine.recoverJobs();
  assert.equal((sqlite.prepare('SELECT status FROM jobs').get() as {status:string}).status,'pending');
});
test('pause prevents queue execution', async () => {
  const lead=create();crm.requestContact(lead.id);crm.pause('Teste');assert.equal(await engine.tick(),false);assert.equal(crm.getLead(lead.id)?.stage,'qualified');
});
test('live sending is blocked without explicit configuration', () => {
  const lead=create('live.test','live');assert.throws(()=>crm.requestContact(lead.id),/desativado/);assert.equal(sqlite.prepare('SELECT * FROM jobs').all().length,0);
});
test('unverified claims cannot enter assembled replies', () => {
  const lead=create();const reply=approvedReply(lead,{intent:'asked_info',action:'present',claimIndex:0,questionIndex:3});
  assert.match(reply,/Posso explicar/);assert.doesNotMatch(reply,/garantido|dobrar|100%/i);
});
test('A/B assignment is deterministic across modes', () => {
  assert.equal(create('variant.test').variant,create('variant.test','live').variant);
});
test('clock helpers enforce timezone, closed windows, invalid timestamps', () => {
  assert.equal(domain.inOperatingHours(new Date('2026-10-14T13:00:00Z'),'09:00-20:00','America/Sao_Paulo'),true);
  assert.equal(domain.apiWindowOpen(null),false);assert.equal(domain.apiWindowOpen('invalid'),false);assert.equal(domain.apiWindowOpen(new Date(Date.now()+60000).toISOString()),false);
  assert.equal(domain.isOptOut('PARE de me chamar'),true);
});
test('both funnels simulate correctly without inventing affiliate terms', async () => {
  crm.demo();await finishQueue();
  assert.equal(crm.listLeads().filter(lead=>lead.funnel==='customer'&&lead.stage==='whatsapp_handoff').length,2);
  assert.equal(crm.listLeads().find(lead=>lead.funnel==='affiliate')?.channel,'human_review_required');
});
test('SQLite backup and restore preserves data and integrity', async () => {
  create();mkdirSync('backups',{recursive:true});const path=`backups/test-${randomUUID()}.db`;await sqlite.backup(path);
  const restored=new Database(path,{readonly:true});assert.equal((restored.prepare('SELECT COUNT(*) as count FROM leads').get() as {count:number}).count,1);
  assert.equal(restored.pragma('quick_check',{simple:true}),'ok');restored.close();
});
test('monthly budget reserves calls atomically and pauses before exceeding limit', () => {
  const lead=create();const previous={input:env.OPENAI_INPUT_USD_PER_MILLION,output:env.OPENAI_OUTPUT_USD_PER_MILLION,budget:env.OPENAI_MONTHLY_BUDGET_USD};
  try {
    env.OPENAI_INPUT_USD_PER_MILLION=1;env.OPENAI_OUTPUT_USD_PER_MILLION=1;env.OPENAI_MONTHLY_BUDGET_USD=0.002;
    reserveBudget(lead.id,'test-model',1000,500);
    assert.throws(()=>reserveBudget(lead.id,'test-model',1000,500),/Orçamento/);
    assert.equal(crm.setting('paused'),'true');assert.equal(sqlite.prepare('SELECT * FROM ai_calls').all().length,1);
  } finally { env.OPENAI_INPUT_USD_PER_MILLION=previous.input;env.OPENAI_OUTPUT_USD_PER_MILLION=previous.output;env.OPENAI_MONTHLY_BUDGET_USD=previous.budget; }
});
test('webhook signature rejects absent, malformed and tampered signatures', () => {
  const previous=env.INSTAGRAM_APP_SECRET;
  try {env.INSTAGRAM_APP_SECRET='test-secret';const body='{"object":"instagram"}';const signed=`sha256=${createHmac('sha256',env.INSTAGRAM_APP_SECRET).update(body).digest('hex')}`;
    assert.equal(validSignature(body,signed),true);assert.equal(validSignature(body+' ',signed),false);assert.equal(validSignature(body,null),false);assert.equal(validSignature(body,'sha256=123'),false);
  } finally {env.INSTAGRAM_APP_SECRET=previous;}
});

test('polling reads managed conversations only, ignores history and echoes, coalesces replies and deduplicates', async () => {
  const lead = create('managed.local', 'live');
  const cutoff = new Date(Date.now()-60000).toISOString();
  sqlite.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),lead.id,'outbound','browser','Olá','sent','poll-contact',null,cutoff);
  const timestamps = [new Date(Date.now()-40000).toISOString(),new Date(Date.now()-30000).toISOString()];
  const fetched: string[] = [];
  const mock = async (path: string): Promise<Record<string, unknown>> => {
    fetched.push(path);
    if (path.includes('/conversations?')) return {data:[
      {id:'personal',participants:{data:[{id:env.INSTAGRAM_BUSINESS_ACCOUNT_ID},{id:'other',username:'unmanaged'}]}},
      {id:'managed',participants:{data:[{id:env.INSTAGRAM_BUSINESS_ACCOUNT_ID},{id:'sender',username:'managed.local'}]}}
    ]};
    if (path.startsWith('managed?')) return {messages:{data:[{id:'second',created_time:timestamps[1]},{id:'first',created_time:timestamps[0]},{id:'echo',created_time:timestamps[0]},{id:'old',created_time:'2020-01-01T00:00:00Z'}]}};
    const id=path.split('?')[0];
    return {id,created_time:id==='second'?timestamps[1]:timestamps[0],from:{id:id==='echo'?env.INSTAGRAM_BUSINESS_ACCOUNT_ID:'sender'},to:{data:[{id:env.INSTAGRAM_BUSINESS_ACCOUNT_ID}]},message:'Tenho interesse'};
  };
  assert.equal((await pollInstagramInbox(mock)).received,2);
  assert.equal(crm.getLead(lead.id)?.metaId,'sender');
  assert.equal(crm.getLead(lead.id)?.lastInboundAt,timestamps[1]);
  assert.equal(sqlite.prepare("SELECT id FROM jobs WHERE kind='reply' AND status='pending'").all().length,1);
  assert.equal((await pollInstagramInbox(mock)).received,0);
  assert.equal(fetched.some(path=>path.startsWith('personal?')||path.startsWith('old?')),false);
});

test('polling does not inspect inbox before a managed first contact and handles opt-out while paused', async () => {
  const lead=create('removal.local','live');
  await pollInstagramInbox(async()=>{throw new Error('Inbox should not be fetched');});
  const timestamp=new Date(Date.now()-10000).toISOString();
  sqlite.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),lead.id,'outbound','browser','Olá','sent','removal-contact',null,new Date(Date.now()-20000).toISOString());
  crm.pause('Operador');
  await pollInstagramInbox(async(path)=>{
    if(path.includes('/conversations?')) return {data:[{id:'thread',participants:{data:[{id:env.INSTAGRAM_BUSINESS_ACCOUNT_ID},{id:'sender',username:'removal.local'}]}}]};
    if(path.startsWith('thread?')) return {messages:{data:[{id:'remove',created_time:timestamp}]}};
    return {id:'remove',created_time:timestamp,from:{id:'sender'},to:{data:[{id:env.INSTAGRAM_BUSINESS_ACCOUNT_ID}]},message:'Não me envie mensagens'};
  });
  assert.equal(crm.blocked(lead.handle),true);
  assert.equal(crm.setting('paused'),'true');
  assert.equal(sqlite.prepare("SELECT id FROM jobs WHERE status='pending'").all().length,0);
});

test('incoming messages preserve human review and out-of-order arrivals do not regress latest context', () => {
  const lead=create();
  const latest=crm.now();
  crm.receiveInbound(lead.id,'newer','Quero saber mais',latest);
  crm.receiveInbound(lead.id,'older','Olá','2020-01-01T00:00:00Z');
  assert.equal(crm.getLead(lead.id)?.lastInboundAt,latest);
  assert.equal(sqlite.prepare("SELECT id FROM jobs WHERE status='pending'").all().length,1);
  crm.patchLead(lead.id,{channel:'human_review_required'});
  sqlite.prepare("UPDATE jobs SET status='cancelled'").run();
  crm.receiveInbound(lead.id,'review','E agora?');
  assert.equal(crm.getLead(lead.id)?.channel,'human_review_required');
  assert.equal(sqlite.prepare("SELECT id FROM jobs WHERE status='pending'").all().length,0);
});

test('connection pilot uses fixed test messages, requires no invented revenue and ends after API acknowledgement', async () => {
  const lead=crm.addLead({handle:'pilot.account',name:'Teste autorizado',purpose:'pilot',mode:'simulation'});
  crm.requestContact(lead.id);
  await finishQueue();
  const sent=sqlite.prepare("SELECT text FROM messages WHERE direction='outbound' AND lead_id=? ORDER BY rowid").all(lead.id) as {text:string}[];
  assert.deepEqual(sent.map(message=>message.text),['Teste de conexão do Prospecta AI. Pode responder esta mensagem?','Conexão do Prospecta AI confirmada. Obrigado pelo teste!']);
  assert.equal(crm.getLead(lead.id)?.monthlyRevenue,null);
  assert.equal(crm.getLead(lead.id)?.channel,'human_review_required');
  assert.equal(crm.getLead(lead.id)?.stage,'closed');
});

test('polling recognizes scoped owner ID, records official outbound confirmation and routes media to human review', async () => {
  const previous=env.INSTAGRAM_SCOPED_ACCOUNT_ID;
  env.INSTAGRAM_SCOPED_ACCOUNT_ID='scoped-owner';
  try {
    const lead=create('media.account','live');
    const contactAt=new Date(Date.now()-20000).toISOString();
    const inboundAt=new Date(Date.now()-10000).toISOString();
    sqlite.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?)').run('outgoing-record',lead.id,'outbound','browser','Olá','sent','media-contact',null,contactAt);
    const mock=async(path:string):Promise<Record<string,unknown>>=>{
      if(path.includes('/conversations?')) return {data:[{id:'thread',participants:{data:[{id:'scoped-owner'},{id:'sender',username:'media.account'}]}}]};
      if(path.startsWith('thread?')) return {messages:{data:[{id:'own-message',created_time:contactAt},{id:'audio-message',created_time:inboundAt}]}};
      if(path.startsWith('own-message?')) return {id:'own-message',created_time:contactAt,from:{id:'scoped-owner'},to:{data:[{id:'sender'}]},message:'Olá'};
      return {id:'audio-message',created_time:inboundAt,from:{id:'sender'},to:{data:[{id:'scoped-owner'}]}};
    };
    await pollInstagramInbox(mock);
    assert.equal((sqlite.prepare('SELECT external_id FROM messages WHERE id=?').get('outgoing-record') as {external_id:string}).external_id,'own-message');
    assert.equal(crm.getLead(lead.id)?.channel,'human_review_required');
    assert.equal(sqlite.prepare('SELECT * FROM exceptions').all().length,1);
    await pollInstagramInbox(mock);
    assert.equal(sqlite.prepare('SELECT * FROM exceptions').all().length,1);
  } finally {env.INSTAGRAM_SCOPED_ACCOUNT_ID=previous;}
});

test('superseded reply job cannot send even when incoming messages share a timestamp', async () => {
  const lead=create();
  const timestamp=crm.now();
  crm.receiveInbound(lead.id,'fragment-one','Olá',timestamp);
  const older=sqlite.prepare("SELECT * FROM jobs WHERE idempotency_key='reply:fragment-one'").get() as import('../src/worker/engine').Job;
  crm.receiveInbound(lead.id,'fragment-two','Quero saber mais',timestamp);
  await engine.processJob(older);
  assert.equal(sqlite.prepare("SELECT * FROM messages WHERE direction='outbound'").all().length,0);
});

test('revenue qualification requires a monthly declaration or a direct answer to the financial question',()=>{
  const question='O faturamento mensal fica acima de R$ 50.000?';
  assert.equal(revenueFromAnswer('Sim',question,50000),'qualified');
  assert.equal(revenueFromAnswer('Sim, tenho interesse','Posso explicar?',50000),'unknown');
  assert.equal(revenueFromAnswer('Faturamos R$ 80.000 por mês','',50000),'qualified');
  assert.equal(revenueFromAnswer('50 mil',question,50000),'not_qualified');
  assert.equal(revenueFromAnswer('Acima de 50 mil',question,50000),'qualified');
  assert.equal(revenueFromAnswer('Faturamos 80 mil por ano',question,50000),'unknown');
  assert.equal(revenueFromAnswer('Não sei',question,50000),'unknown');
  assert.equal(revenueFromAnswer('Não',question,50000),'not_qualified');
  assert.equal(revenueFromAnswer('Entre 40 e 60 mil',question,50000),'unknown');
  assert.equal(revenueFromAnswer('O lucro foi 60 mil',question,50000),'unknown');
  assert.equal(meetingFormatFromAnswer('Online','Podemos fazer uma apresentação online ou presencial?'),'online');
  assert.equal(meetingFormatFromAnswer('Trabalho online','Como atende hoje?'),'');
});

test('meeting replies collect preferences and never promise an available appointment',()=>{
  const lead=create();crm.patchLead(lead.id,{meetingFormat:'online',meetingTime:'quinta às 15h'});
  const reply=approvedReply(crm.getLead(lead.id)!,{intent:'interested',action:'schedule',claimIndex:-1,questionIndex:-1});
  assert.match(reply,/quinta às 15h/);assert.match(reply,/ainda precisa ser confirmado/);assert.match(reply,/wa.me/);
  assert.match(approvedReply(lead,{intent:'interested',action:'invite',claimIndex:-1,questionIndex:-1}),/online ou presencial em Patos de Minas/);
});

test('discovery accepts cited business profiles, deduplicates and never invents revenue',async()=>{
  const run='test-run';sqlite.prepare('INSERT INTO discovery_runs (id,query,segment,status,created_at) VALUES (?,?,?,?,?)').run(run,'Pesquisa','lojas','processing',crm.now());
  const valid={handle:'local.company',name:'Loja local',niche:'Loja de móveis',city:'Patos de Minas',sourceUrl:'https://example.com/loja',profileUrl:'https://www.instagram.com/local.company/',localityEvidence:'Loja em Patos de Minas',businessEvidence:'Loja de móveis e decoração',isCompany:true};
  const fakeInspect=async()=>({verified:true,local:true,business:true,address:'',note:'Perfil local conferido'});
  const count=await importCandidates(run,{candidates:[valid,valid,{...valid,handle:'uncited',sourceUrl:'https://other.example/'},{...valid,handle:'not.local',profileUrl:'https://www.instagram.com/not.local/',city:'Uberlândia'}],sources:[valid.sourceUrl],cost:0,toolCalls:1},fakeInspect);
  assert.equal(count,1);assert.equal(crm.listLeads().length,1);assert.equal(crm.listLeads()[0].monthlyRevenue,null);
  assert.equal(sqlite.prepare('SELECT * FROM lead_sources').all().length,1);
  assert.equal(sqlite.prepare('SELECT * FROM jobs').all().length,0);
  assert.equal(profileEvidence('Loja de móveis em Patos de Minas','Patos de Minas').verified,true);
  assert.equal(profileEvidence('Loja de móveis em Uberlândia','Patos de Minas').verified,false);
});

test('profile links reject content routes and public source fetches reject private network addresses',()=>{
  assert.equal(companyHandleMatchesName('lojadeexemplo_19','Loja de Exemplo'),true);
  assert.equal(companyHandleMatchesName('autopecasprimus_',"Auto Peças Primu's"),true);
  assert.equal(companyHandleMatchesName('econodata.br','Paralelo Auto Pecas'),false);
  assert.equal(companyHandleMatchesName('mymagicpindelhi',"Auto Peças Primu's"),false);
  assert.equal(instagramHandle('https://www.instagram.com/local.company/'),'local.company');
  for(const url of ['https://www.instagram.com/p/post','https://instagram.com/accounts','http://instagram.com/company','https://instagram.com.evil/company','https://user:secret@instagram.com/company']) assert.equal(instagramHandle(url),null);
  assert.deepEqual(instagramLinks('<a href="https://www.instagram.com/loja.local/">Instagram</a>'),['https://www.instagram.com/loja.local']);
  for(const address of ['127.0.0.1','10.0.0.1','192.168.1.5','169.254.169.254','::1','fd00::1']) assert.equal(publicAddress(address),false);
  assert.equal(publicAddress('8.8.8.8'),true);
});

test('map rejects city centroid and other municipalities instead of creating fake company pins',()=>{
  const feature=(city:string,osmKey:string)=>({features:[{geometry:{coordinates:[-46.51,-18.60]},properties:{city,name:'Rua Major Gote',street:'Rua Major Gote',countrycode:'BR',osm_key:osmKey}}]});
  assert.equal(locationFromResult(feature('Patos de Minas','place'),'Rua Major Gote, 790','Patos de Minas'),null);
  assert.equal(locationFromResult(feature('Uberlândia','highway'),'Rua Major Gote, 790','Patos de Minas'),null);
  assert.ok(locationFromResult(feature('Patos de Minas','highway'),'Rua Major Gote, 790','Patos de Minas'));
});

test('search tool fees participate in the monthly budget before paid research',()=>{
  const previous=env.OPENAI_MONTHLY_BUDGET_USD;
  try {env.OPENAI_MONTHLY_BUDGET_USD=0.02;assert.throws(()=>reserveBudget(null,'search',0,0,0.03),/Orçamento/);assert.equal(sqlite.prepare('SELECT * FROM ai_calls').all().length,0);}
  finally {env.OPENAI_MONTHLY_BUDGET_USD=previous;}
});

test('automatic approach requires a verified local source, supports unknown revenue qualification and respects five pending contacts',()=>{
  const previous={...env};
  try {
    Object.assign(env,{APP_MODE:'live',ALLOW_LIVE_SENDS:'true',OPENAI_API_KEY:'test-key',OPENAI_MODEL:'test',OPENAI_MODEL_FAST:'test',OPENAI_INPUT_USD_PER_MILLION:0.2,OPENAI_OUTPUT_USD_PER_MILLION:1.25,INSTAGRAM_PAGE_ACCESS_TOKEN:'test-token',INSTAGRAM_BUSINESS_ACCOUNT_ID:'owner',INSTAGRAM_GRAPH_VERSION:'v26.0',INSTAGRAM_INBOUND_MODE:'polling',OPERATING_HOURS:'00:00-23:59',MAX_DMS_PER_DAY:5});
    crm.setSetting('capture_enabled','true');crm.setSetting('capture_auto_contact','true');
    const run='automatic-test';sqlite.prepare('INSERT INTO discovery_runs (id,query,segment,status,created_at) VALUES (?,?,?,?,?)').run(run,'Empresas locais','lojas','completed',crm.now());
    const unverified=crm.addLead({handle:'unverified.local',name:'Empresa sem fonte',mode:'live'});
    assert.throws(()=>crm.requestContact(unverified.id),/confira a fonte/);
    for(let i=0;i<7;i++) {
      const lead=crm.addLead({handle:`verified.${i}`,name:'Loja de teste',city:'Patos de Minas',mode:'live'});
      sqlite.prepare('INSERT INTO lead_sources (lead_id,run_id,source_url,locality_evidence,business_evidence,verified,created_at) VALUES (?,?,?,?,?,?,?)').run(lead.id,run,'https://example.com/','Patos de Minas','Loja de móveis',1,crm.now());
    }
    assert.equal(queueVerifiedProspects(),5);
    assert.equal(queueVerifiedProspects(),0);
    assert.equal(sqlite.prepare("SELECT * FROM jobs WHERE kind='first_contact' AND status='pending'").all().length,5);
    assert.equal(crm.listLeads().every(lead=>lead.monthlyRevenue===null),true);
    crm.pause('Teste');assert.equal(queueVerifiedProspects(),0);
  } finally {Object.assign(env,previous);crm.setSetting('capture_enabled','false');crm.setSetting('capture_auto_contact','false');}
});

test('next capture moves to the operating window instead of advertising a search at night',()=>{
  const previous={hours:env.OPERATING_HOURS,interval:env.CAPTURE_INTERVAL_HOURS};
  try {env.OPERATING_HOURS='09:00-20:00';env.CAPTURE_INTERVAL_HOURS=6;assert.equal(nextCaptureAt(new Date('2026-10-14T20:00:00Z')),'2026-10-15T12:00:00.000Z');}
  finally {env.OPERATING_HOURS=previous.hours;env.CAPTURE_INTERVAL_HOURS=previous.interval;}
});

test('commercial policy keeps qualification and meeting preferences consistent despite model action variation',()=>{
  const lead=crm.addLead({handle:'qualification.policy',name:'Empresa fictícia',mode:'simulation'});
  const present={intent:'interested' as const,action:'present' as const,claimIndex:0,questionIndex:3};
  assert.equal(guardCustomerAction(present,lead,50000).action,'diagnose');
  crm.patchLead(lead.id,{conversationPhase:'diagnosis'});
  assert.equal(guardCustomerAction(present,crm.getLead(lead.id)!,50000).action,'offer');
  crm.patchLead(lead.id,{conversationPhase:'offer'});
  assert.equal(guardCustomerAction(present,crm.getLead(lead.id)!,50000).action,'qualify');
  assert.equal(guardCustomerAction({...present,intent:'ambiguous'},crm.getLead(lead.id)!,50000).action,'human');
  crm.patchLead(lead.id,{revenueStatus:'qualified',conversationPhase:'qualification'});
  assert.equal(guardCustomerAction(present,crm.getLead(lead.id)!,50000).action,'invite');
  crm.patchLead(lead.id,{revenueStatus:'qualified',meetingFormat:'online'});
  assert.equal(guardCustomerAction(present,crm.getLead(lead.id)!,50000).action,'ask_time');
  const answer='Quinta-feira às 15h';
  assert.equal(meetingTimeFromAnswer(answer,'Qual dia e horário funciona melhor para a apresentação?'),answer);
  assert.equal(meetingTimeFromAnswer('Telefone 31999990000','Qual dia e horário funciona melhor para a apresentação?'),'');
  crm.patchLead(lead.id,{meetingTime:answer});
  assert.equal(guardCustomerAction({...present,meetingTimeQuote:answer},crm.getLead(lead.id)!,50000).action,'schedule');
  assert.equal(guardCustomerAction({...present,intent:'opt_out',action:'close'},crm.getLead(lead.id)!,50000).action,'close');
});

test('first contact finds the responsible person without an early product pitch; routing is preserved',()=>{
  const lead=crm.addLead({handle:'copy.local',name:'Loja de Exemplo',mode:'simulation'});
  const copy=engine.firstContactCopy(lead);
  assert.match(copy,/Loja de Exemplo/);assert.match(copy,/É com você que eu falo\?/);
  assert.doesNotMatch(copy,/Vendus|inteligência artificial|faturamento|assistente da/);
  const decision={intent:'not_the_owner' as const,action:'qualify' as const,claimIndex:-1,questionIndex:-1};
  assert.equal(guardCustomerAction(decision,lead,50000).action,'route');
  assert.equal(guardCustomerAction({...decision,intent:'will_forward'},lead,50000).action,'wait');
  assert.equal(guardCustomerAction({...decision,intent:'asked_pricing'},lead,50000).action,'human');
  assert.doesNotMatch(approvedReply(lead,{...decision,action:'diagnose'}),/faturamento|Vendus/);
});

function unansweredFixture(mode='simulation') {
  const lead=create(`follow.${randomUUID().slice(0,8)}`,mode);
  crm.patchLead(lead.id,{channel:'waiting_inbound_reply',stage:'contacted'});
  sqlite.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),lead.id,'outbound',mode==='live'?'browser':'simulation','Primeiro contato','sent',`first:${lead.id}`,null,new Date(Date.now()-1000).toISOString());
  crm.setSetting('follow_up_enabled','true');
  return crm.getLead(lead.id)!;
}
test('three durable follow-ups are spaced, distinct and stop after final closure while allowing a late reply',async()=>{
  const lead=unansweredFixture();
  assert.equal(followUps.scheduleNextFollowUp(lead.id),true);
  assert.equal(followUps.scheduleNextFollowUp(lead.id),false);
  const first=crm.getLead(lead.id)!;assert.ok(Date.parse(first.followUpNextAt)>Date.now()+23*3600000);
  for(let step=1;step<=3;step++) {
    sqlite.prepare("UPDATE jobs SET run_at=? WHERE lead_id=? AND kind='follow_up' AND status='pending'").run(crm.now(),lead.id);
    assert.equal(await engine.tick(),true);
    assert.equal(crm.getLead(lead.id)!.followUpCount,step);
    if(step<3) {assert.equal(followUps.scheduleNextFollowUp(lead.id),true);assert.ok(Date.parse(crm.getLead(lead.id)!.followUpNextAt)>Date.now()+23*3600000);}
  }
  const messages=sqlite.prepare("SELECT text FROM messages WHERE lead_id=? AND direction='outbound' ORDER BY rowid").all(lead.id) as {text:string}[];
  assert.equal(new Set(messages.map(m=>m.text)).size,4);
  assert.match(messages[3].text,/100% com inteligência artificial/);assert.match(messages[3].text,/responda esta mensagem/);
  assert.equal(crm.getLead(lead.id)!.followUpStatus,'finished');assert.equal(crm.getLead(lead.id)!.stage,'closed');
  assert.equal(followUps.scheduleNextFollowUp(lead.id),false);
  crm.receiveInbound(lead.id,'late-reply','Quero conhecer os agentes');
  assert.equal(crm.getLead(lead.id)!.channel,'api_eligible');assert.equal(crm.getLead(lead.id)!.stage,'replied');
  assert.equal(followUps.scheduleNextFollowUp(lead.id),false);
  assert.throws(()=>followUpCopy(4,getBusiness()));
});
test('any reply cancels all pending no-response follow-ups, including while paused',()=>{
  const lead=unansweredFixture();followUps.scheduleNextFollowUp(lead.id);
  crm.pause('Teste');crm.receiveInbound(lead.id,'response-during-pause','Oi, sou eu');
  assert.equal(crm.getLead(lead.id)!.followUpStatus,'cancelled');
  assert.equal((sqlite.prepare("SELECT status FROM jobs WHERE lead_id=? AND kind='follow_up'").get(lead.id) as {status:string}).status,'cancelled');
  assert.equal(followUps.scheduleNextFollowUp(lead.id),false);
});
test('follow-ups respect operating hours, exclude pilots and do not bypass expired API ownership',()=>{
  const previous=env.OPERATING_HOURS;env.OPERATING_HOURS='09:00-20:00';
  try {assert.equal(followUps.nextOperatingAt(new Date('2026-10-14T23:30:00Z')),'2026-10-15T12:00:00.000Z');} finally {env.OPERATING_HOURS=previous;}
  const lead=unansweredFixture();crm.patchLead(lead.id,{channel:'api_window_closed'});
  assert.equal(followUps.scheduleNextFollowUp(lead.id),false);
  crm.patchLead(lead.id,{channel:'waiting_inbound_reply',purpose:'pilot'});assert.equal(followUps.scheduleNextFollowUp(lead.id),false);
});
test('platform-pending follow-ups reserve no message and stop instead of retrying a blocked invitation',async()=>{
  const previous={APP_MODE:env.APP_MODE,ALLOW_LIVE_SENDS:env.ALLOW_LIVE_SENDS,OPERATING_HOURS:env.OPERATING_HOURS,INSTAGRAM_INBOUND_MODE:env.INSTAGRAM_INBOUND_MODE};
  Object.assign(env,{APP_MODE:'live',ALLOW_LIVE_SENDS:'true',OPERATING_HOURS:'00:00-23:59',INSTAGRAM_INBOUND_MODE:'polling'});crm.setSetting('last_browser_send','');
  try {
    const lead=unansweredFixture('live');followUps.scheduleNextFollowUp(lead.id);
    const job=sqlite.prepare("SELECT * FROM jobs WHERE lead_id=? AND kind='follow_up'").get(lead.id) as Job;
    sqlite.prepare("UPDATE jobs SET status='processing' WHERE id=?").run(job.id);
    await engine.processFollowUp(job,{poll:async()=>({matched:1,received:0}),send:async()=>{throw new MessageRequestPendingError('Convite enviado');}});
    assert.equal(crm.getLead(lead.id)!.followUpStatus,'platform_blocked');assert.equal(crm.getLead(lead.id)!.followUpCount,0);
    assert.equal(sqlite.prepare('SELECT id FROM messages WHERE idempotency_key=?').get(job.idempotency_key),undefined);
    assert.equal(followUps.scheduleNextFollowUp(lead.id),false);assert.equal(crm.setting('paused'),'false');
    assert.equal(pendingMessageRequest('Convite enviado. Você pode enviar mais mensagens quando seu convite for aceito.'),true);
    assert.equal(pendingMessageRequest('You can only send one message until they accept your chat invite.'),true);
    assert.equal(pendingMessageRequest('Mensagens. Digite uma mensagem...'),false);
  } finally {Object.assign(env,previous);}
});
test('a reply arriving during composition prevents a follow-up reservation and send',async()=>{
  const previous={APP_MODE:env.APP_MODE,ALLOW_LIVE_SENDS:env.ALLOW_LIVE_SENDS,OPERATING_HOURS:env.OPERATING_HOURS,INSTAGRAM_INBOUND_MODE:env.INSTAGRAM_INBOUND_MODE};
  Object.assign(env,{APP_MODE:'live',ALLOW_LIVE_SENDS:'true',OPERATING_HOURS:'00:00-23:59',INSTAGRAM_INBOUND_MODE:'polling'});crm.setSetting('last_browser_send','');
  try {
    const lead=unansweredFixture('live');followUps.scheduleNextFollowUp(lead.id);
    const job=sqlite.prepare("SELECT * FROM jobs WHERE lead_id=? AND kind='follow_up'").get(lead.id) as Job;
    sqlite.prepare("UPDATE jobs SET status='processing' WHERE id=?").run(job.id);
    let polls=0,sent=false;
    await engine.processFollowUp(job,{poll:async()=>{if(++polls===2) crm.receiveInbound(lead.id,'during-composition','Sou o responsável');return {matched:1,received:polls===2?1:0};},send:async(_handle,_text,_job,_dry,beforeSend)=>{await beforeSend!();sent=true;return {dryRun:false,url:'test'};}});
    assert.equal(sent,false);assert.equal(crm.getLead(lead.id)!.followUpStatus,'cancelled');
    assert.equal(sqlite.prepare('SELECT id FROM messages WHERE idempotency_key=?').get(job.idempotency_key),undefined);
  } finally {Object.assign(env,previous);}
});

test('follow-ups share the daily browser cap with first contacts and defer without reserving a message',async()=>{
  const previous={APP_MODE:env.APP_MODE,ALLOW_LIVE_SENDS:env.ALLOW_LIVE_SENDS,OPERATING_HOURS:env.OPERATING_HOURS,INSTAGRAM_INBOUND_MODE:env.INSTAGRAM_INBOUND_MODE,MAX_DMS_PER_DAY:env.MAX_DMS_PER_DAY};
  Object.assign(env,{APP_MODE:'live',ALLOW_LIVE_SENDS:'true',OPERATING_HOURS:'00:00-23:59',INSTAGRAM_INBOUND_MODE:'polling',MAX_DMS_PER_DAY:5});
  try {
    const lead=unansweredFixture('live');followUps.scheduleNextFollowUp(lead.id);
    for(let i=0;i<4;i++) sqlite.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),lead.id,'outbound','browser','Envio já realizado','sent',`daily-cap:${i}`,null,crm.now());
    const job=sqlite.prepare("SELECT * FROM jobs WHERE lead_id=? AND kind='follow_up'").get(lead.id) as Job;
    sqlite.prepare("UPDATE jobs SET status='processing' WHERE id=?").run(job.id);
    assert.equal(await engine.processFollowUp(job,{poll:async()=>({matched:1,received:0}),send:async()=>{throw new Error('Must not send after daily cap');}}),'deferred');
    const deferred=sqlite.prepare('SELECT status,run_at FROM jobs WHERE id=?').get(job.id) as {status:string;run_at:string};
    assert.equal(deferred.status,'pending');assert.ok(Date.parse(deferred.run_at)>=Date.now()+23*3600000);
    assert.equal(sqlite.prepare('SELECT id FROM messages WHERE idempotency_key=?').get(job.idempotency_key),undefined);
    assert.equal(crm.getLead(lead.id)!.followUpCount,0);
  } finally {Object.assign(env,previous);}
});
test('restart recovers a scheduled follow-up once and uncertain delivery blocks automatic retry',async()=>{
  const lead=unansweredFixture();followUps.scheduleNextFollowUp(lead.id);
  const job=sqlite.prepare("SELECT * FROM jobs WHERE lead_id=? AND kind='follow_up'").get(lead.id) as Job;
  sqlite.prepare("UPDATE jobs SET status='processing' WHERE id=?").run(job.id);engine.recoverJobs();engine.recoverJobs();
  assert.equal(sqlite.prepare("SELECT id FROM jobs WHERE kind='follow_up' AND status='pending'").all().length,1);
  sqlite.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),lead.id,'outbound','simulation','Mensagem com resultado incerto','reserved',job.idempotency_key,null,crm.now());
  sqlite.prepare("UPDATE jobs SET status='processing' WHERE id=?").run(job.id);engine.recoverJobs();
  assert.equal(crm.setting('paused'),'true');assert.equal(crm.getLead(lead.id)!.channel,'human_review_required');
  assert.equal(followUps.scheduleNextFollowUp(lead.id),false);
});

test('a network page selects the referenced local branch and never imports every other city',()=>{
  const html=['alfenas','aracuai','barbacena','pampulha','patos'].map(city=>`<a href="https://www.instagram.com/academiagalo_${city}/">Unidade ${city}</a>`).join('');
  assert.deepEqual(companyInstagramProfiles(html,'Academia de Futebol do Galo','INSTAGRAM: @academiagalo_patos'),['https://www.instagram.com/academiagalo_patos']);
  assert.deepEqual(companyInstagramProfiles(html,'Academia de Futebol do Galo','Unidade em Patos de Minas'),[]);
  assert.deepEqual(companyInstagramProfiles(html,'Academia de Futebol do Galo','INSTAGRAM: @academiagalo_inventado'),[]);
  assert.deepEqual(companyInstagramProfiles('<a href="https://instagram.com/lojadeexemplo_19">Instagram</a>','Loja de Exemplo','Loja de móveis local'),['https://instagram.com/lojadeexemplo_19']);
});

test('first contact reserves only immediately before sending; an unavailable editor cannot create uncertain delivery',async()=>{
  const previous={APP_MODE:env.APP_MODE,ALLOW_LIVE_SENDS:env.ALLOW_LIVE_SENDS,OPERATING_HOURS:env.OPERATING_HOURS};
  Object.assign(env,{APP_MODE:'live',ALLOW_LIVE_SENDS:'true',OPERATING_HOURS:'00:00-23:59'});crm.setSetting('last_browser_send','');
  try {
    const lead=create('composer.check','live');crm.requestContact(lead.id);
    assert.equal(await engine.tick({sendBrowser:async()=>{throw new MessageComposerUnavailableError('Campo de mensagem não abriu para este perfil; nenhuma mensagem foi digitada ou enviada.');}}),true);
    assert.equal(sqlite.prepare('SELECT id FROM messages WHERE lead_id=?').get(lead.id),undefined);
    assert.equal(crm.getLead(lead.id)!.channel,'human_review_required');assert.equal(crm.setting('paused'),'false');
    assert.equal((sqlite.prepare('SELECT status FROM jobs WHERE lead_id=?').get(lead.id) as {status:string}).status,'failed');
  } finally {Object.assign(env,previous);}
});

test('delivery confirmation reopens only an observed Instagram thread, without credentials or external navigation',()=>{
  assert.equal(instagramThreadUrl('/direct/t/17844858186008126'),'https://www.instagram.com/direct/t/17844858186008126');
  assert.equal(instagramThreadUrl('https://www.instagram.com/direct/inbox/'),null);
  assert.equal(instagramThreadUrl('https://other.example/direct/t/123'),null);
  assert.equal(instagramThreadUrl('https://secret@www.instagram.com/direct/t/123'),null);
});

test('approved research opening reaches the sender and survives interval deferral',async()=>{
  const previous={APP_MODE:env.APP_MODE,ALLOW_LIVE_SENDS:env.ALLOW_LIVE_SENDS,OPERATING_HOURS:env.OPERATING_HOURS};
  Object.assign(env,{APP_MODE:'live',ALLOW_LIVE_SENDS:'true',OPERATING_HOURS:'00:00-23:59'});
  try {
    const lead=create('research.opening','live');crm.requestContact(lead.id);
    const payload=JSON.stringify({approvedOpening:'Oi! Vi os serviços da sua empresa em Patos. Quem cuida do atendimento?',researchId:'PM002'});
    sqlite.prepare('UPDATE jobs SET payload=? WHERE lead_id=?').run(payload,lead.id);
    crm.setSetting('last_browser_send',crm.now());
    await engine.tick({sendBrowser:async()=>{throw new Error('Interval must defer');}});
    const deferred=sqlite.prepare("SELECT * FROM jobs WHERE lead_id=? AND status='pending'").get(lead.id) as Job;
    assert.equal(deferred.payload,payload);
    sqlite.prepare('UPDATE jobs SET run_at=? WHERE id=?').run(crm.now(),deferred.id);
    crm.setSetting('last_browser_send','');
    let delivered='';
    await engine.tick({sendBrowser:async(_handle,text,_id,_dry,beforeSend)=>{await beforeSend?.();delivered=text;return {dryRun:false,url:'https://www.instagram.com/research.opening/'};}});
    assert.equal(delivered,JSON.parse(payload).approvedOpening);
    assert.equal((sqlite.prepare('SELECT text,status FROM messages WHERE lead_id=?').get(lead.id) as {text:string;status:string}).status,'sent');
  } finally {Object.assign(env,previous);crm.setSetting('last_browser_send','');}
});
