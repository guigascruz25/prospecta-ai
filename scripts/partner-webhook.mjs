import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {config} from 'dotenv';
export function researchPayload(row) {
  if(!row.id||!row.name||!row.sourceUrl)throw new Error('Cada empresa precisa de id, name e sourceUrl.');
  const externalId=`prospecta:${String(row.id)}`;
  return {event:'lead.researched',external_id:externalId,name:String(row.name),company:String(row.name),phone:row.phone||'',email:row.email||'',instagram:row.instagram||'',website:row.website||'',city:row.city||'',source:'Prospecta AI — pesquisa comercial',status:'research_only',allow_contact:false,auto_contact:false,notes:['PESQUISA COMERCIAL — SEM ABORDAGEM AUTORIZADA',`ID: ${externalId}`,`Empresa: ${row.name}`,`Segmento: ${row.segment||'A confirmar'}`,`Cidade: ${row.city||'A confirmar'}`,`Fonte: ${row.sourceUrl}`,`Contexto: ${row.overview||'A confirmar'}`,`Fatos e fontes: ${JSON.stringify(row.observations||[])}`,`Hipótese a validar: ${row.opportunity||'A confirmar'}`,`Rascunho não enviado: ${row.opening||''}`,'Faturamento e decisor: confirmar em conversa.'].join('\n\n'),research:row};
}
export async function exportResearch(rows,{directory,send=false,url='',confirmed=false,fetcher=fetch}) {
  if(!Array.isArray(rows)||rows.length<1||rows.length>500)throw new Error('Informe uma lista de 1 a 500 empresas.');
  const payloads=rows.map(researchPayload);if(new Set(payloads.map(p=>p.external_id)).size!==payloads.length)throw new Error('IDs de pesquisa duplicados.');
  await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'preview.json'),JSON.stringify(payloads,null,2));
  if(!send)return {prepared:payloads.length,sent:0,preview:path.join(directory,'preview.json')};
  const target=new URL(url);
  if(target.protocol!=='https:'||target.hostname!=='app.vendus.com.br'||target.port||target.username||target.password||!/^\/functions\/v1\/webhook-receiver\/[a-f0-9-]{36}$/i.test(target.pathname)||target.search||target.hash)throw new Error('Use o webhook HTTPS da sua própria conta Vendus.');
  if(!confirmed)throw new Error('Confira no Vendus que o webhook só cria/atualiza leads e dossiês, sem squad, mensagens ou cadências; então configure VENDUS_WEBHOOK_RESEARCH_ONLY_CONFIRMED=true.');
  const destination=createHash('sha256').update(target.href).digest('hex').slice(0,12);const receipts=[];
  for(const payload of payloads) {
    const body=JSON.stringify(payload);const key=createHash('sha256').update(`${destination}:${payload.external_id}`).digest('hex');const receiptFile=path.join(directory,`${key}.json`);
    let existing;try{existing=JSON.parse(await fs.readFile(receiptFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(existing){receipts.push({id:payload.external_id,outcome:'already_attempted'});continue;}
    const receipt={id:payload.external_id,destination,sha256:createHash('sha256').update(body).digest('hex'),startedAt:new Date().toISOString(),outcome:'pending'};
    await fs.writeFile(receiptFile,JSON.stringify(receipt,null,2),{flag:'wx'});
    try{const response=await fetcher(target.href,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','Idempotency-Key':key},body,signal:AbortSignal.timeout(30000)});receipt.httpStatus=response.status;receipt.outcome=response.ok?'http_accepted':'rejected';const text=await response.text();try{const result=JSON.parse(text);receipt.crmLeadConfirmed=Boolean(response.ok&&result.success===true&&result.lead_id);receipt.leadId=receipt.crmLeadConfirmed?result.lead_id:null;}catch{receipt.crmLeadConfirmed=false;}}
    catch{receipt.outcome='unknown';}
    receipt.finishedAt=new Date().toISOString();await fs.writeFile(receiptFile,JSON.stringify(receipt,null,2));receipts.push(receipt);
    if(['unknown','rejected'].includes(receipt.outcome))break;
  }
  return {prepared:payloads.length,attempted:receipts.length,receipts};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);config({quiet:true});
  const input=process.argv[2];if(!input)throw new Error('Uso: node scripts/partner-webhook.mjs data/minha-pesquisa.json [--send]');
  const rows=JSON.parse(await fs.readFile(input,'utf8'));
  console.log(JSON.stringify(await exportResearch(rows,{directory:'data/webhook-export',send:process.argv.includes('--send'),url:process.env.VENDUS_WEBHOOK_URL,confirmed:process.env.VENDUS_WEBHOOK_RESEARCH_ONLY_CONFIRMED==='true'}),null,2));
}
