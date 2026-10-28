import {readFileSync,writeFileSync,renameSync,existsSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {parse} from 'dotenv';
import {z} from 'zod';
import {isIP} from 'node:net';
import {publicAddress} from '../integrations/public-website';
import {env,envSchema,integrationKeys,reloadIntegrationEnv} from '../lib/config';

export const integrationSections={
  openai:['OPENAI_API_KEY','OPENAI_MODEL','OPENAI_MODEL_FAST','OPENAI_MONTHLY_BUDGET_USD','OPENAI_INPUT_USD_PER_MILLION','OPENAI_OUTPUT_USD_PER_MILLION','OPENAI_WEB_SEARCH_USD_PER_CALL'],
  instagram:['INSTAGRAM_PAGE_ACCESS_TOKEN','INSTAGRAM_APP_SECRET','INSTAGRAM_WEBHOOK_VERIFY_TOKEN','INSTAGRAM_BUSINESS_ACCOUNT_ID','INSTAGRAM_SCOPED_ACCOUNT_ID','INSTAGRAM_GRAPH_VERSION','INSTAGRAM_INBOUND_MODE','INSTAGRAM_POLL_INTERVAL_SECONDS'],
  chrome:['CHROME_CDP_URL'],
  webhook:['OUTBOUND_WEBHOOK_URL','OUTBOUND_WEBHOOK_LABEL','OUTBOUND_WEBHOOK_HEADER_NAME','OUTBOUND_WEBHOOK_HEADER_VALUE','OUTBOUND_WEBHOOK_ENABLED','OUTBOUND_WEBHOOK_AUTO_EXPORT','OUTBOUND_WEBHOOK_RESEARCH_ONLY_CONFIRMED']
} as const;
export type IntegrationSection=keyof typeof integrationSections;
const secrets=new Set<string>(['OPENAI_API_KEY','INSTAGRAM_PAGE_ACCESS_TOKEN','INSTAGRAM_APP_SECRET','INSTAGRAM_WEBHOOK_VERIFY_TOKEN','OUTBOUND_WEBHOOK_URL','OUTBOUND_WEBHOOK_HEADER_VALUE']);
export function validateWebhookUrl(value:string) {
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port&&url.port!=='443'||url.hostname==='localhost'||/\.(local|internal)$/i.test(url.hostname))throw new Error('Use um webhook HTTPS público, sem usuário, senha ou fragmento na URL.');
  const hostname=url.hostname.replace(/^\[|\]$/g,'');
  if(isIP(hostname)&&!publicAddress(hostname))throw new Error('Use um webhook em servidor público, fora da rede local.');
  return url;
}
export function safeIntegrationSettings() {
  reloadIntegrationEnv();
  return maskIntegrationSettings(env);
}
export function maskIntegrationSettings(config:typeof env) {
  return {values:Object.fromEntries(integrationKeys.filter(key=>!secrets.has(key)).map(key=>[key,String(config[key])])),configured:Object.fromEntries([...secrets].map(key=>[key,Boolean(config[key as keyof typeof env])])),webhookHost:config.OUTBOUND_WEBHOOK_URL?new URL(config.OUTBOUND_WEBHOOK_URL).hostname:'',appliesWithoutRestart:true};
}
export function saveIntegrationSettings(section:IntegrationSection,values:Record<string,unknown>,clearSecrets:string[]=[],root=process.cwd()) {
  const allowed=new Set<string>(integrationSections[section]);
  if(!allowed.size||Object.keys(values).some(key=>!allowed.has(key))||clearSecrets.some(key=>!allowed.has(key)||!secrets.has(key)))throw new Error('Campo de integração não permitido.');
  const filename=path.join(root,'.env');
  const previous=existsSync(filename)?readFileSync(filename,'utf8'):'';
  const current=parse(previous);
  const changes:Record<string,string>={};
  for(const [key,input] of Object.entries(values)) {
    if(typeof input!=='string'||input.length>6000||/[\r\n\0"\\]/.test(input))throw new Error(`Confira o campo ${key}.`);
    const value=input.trim();
    if(secrets.has(key)&&!value)continue;
    changes[key]=value;
  }
  for(const key of clearSecrets)changes[key]='';
  const candidate={...env,...current,...changes};
  envSchema.parse(candidate);
  if(candidate.CHROME_CDP_URL){const url=new URL(candidate.CHROME_CDP_URL);if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.port||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('O Chrome deve usar HTTP local com porta explícita, por exemplo http://127.0.0.1:9222.');}
  if(candidate.INSTAGRAM_GRAPH_VERSION&&!/^v\d+\.\d+$/.test(candidate.INSTAGRAM_GRAPH_VERSION))throw new Error('Informe a versão Graph no formato vXX.X.');
  for(const key of ['INSTAGRAM_BUSINESS_ACCOUNT_ID','INSTAGRAM_SCOPED_ACCOUNT_ID'])if(candidate[key as keyof typeof candidate]&&!/^\d{5,40}$/.test(String(candidate[key as keyof typeof candidate])))throw new Error(`Confira o ID numérico em ${key}.`);
  if(candidate.OUTBOUND_WEBHOOK_URL)validateWebhookUrl(String(candidate.OUTBOUND_WEBHOOK_URL));
  if(!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(candidate.OUTBOUND_WEBHOOK_HEADER_NAME)||/^(host|content-length|content-type|connection|cookie|set-cookie|proxy-authorization|transfer-encoding|idempotency-key)$/i.test(candidate.OUTBOUND_WEBHOOK_HEADER_NAME))throw new Error('Use um cabeçalho de autenticação, como Authorization ou X-API-Key.');
  if(candidate.OUTBOUND_WEBHOOK_ENABLED==='true'&&!candidate.OUTBOUND_WEBHOOK_URL)throw new Error('Informe a URL antes de habilitar o webhook.');
  if(candidate.OUTBOUND_WEBHOOK_AUTO_EXPORT==='true'&&candidate.OUTBOUND_WEBHOOK_ENABLED!=='true')throw new Error('Habilite o webhook antes de ativar o envio automático.');
  if(candidate.OUTBOUND_WEBHOOK_ENABLED==='true'&&candidate.OUTBOUND_WEBHOOK_RESEARCH_ONLY_CONFIRMED!=='true')throw new Error('Confirme a configuração de cadastro de dados no destino antes de habilitar o webhook.');
  const seen=new Set<string>();
  const lines=previous.split(/\r?\n/).map(line=>{const match=line.match(/^\s*([A-Z_]+)\s*=/);if(!match||changes[match[1]]===undefined)return line;const key=match[1];if(seen.has(key))return '';seen.add(key);return `${key}=${JSON.stringify(changes[key])}`;});
  for(const [key,value] of Object.entries(changes))if(!seen.has(key))lines.push(`${key}=${JSON.stringify(value)}`);
  const temp=filename+`.${randomUUID()}.tmp`;
  try {writeFileSync(temp,lines.join('\n').replace(/\n+$/,'')+'\n',{mode:0o600,flag:'wx'});renameSync(temp,filename);} finally {if(existsSync(temp))unlinkSync(temp);}
  if(root===process.cwd())reloadIntegrationEnv();
  return {ok:true};
}
export const integrationSaveSchema=z.object({section:z.enum(['openai','instagram','chrome','webhook']),values:z.record(z.string(),z.unknown()),clearSecrets:z.array(z.string()).max(6).default([])});
