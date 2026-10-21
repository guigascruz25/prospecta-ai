import {readFile,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';

export function installationId(root) {
  let normalized=path.resolve(root).replaceAll('\\','/').replace(/\/$/,'');
  if(process.platform==='win32')normalized=normalized.toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').slice(0,20);
}
const exists=async target=>{try{await access(target);return true;}catch{return false;}};
async function jsonFile(target){try{return JSON.parse(await readFile(target,'utf8'));}catch{return null;}}
export async function inspectInstallation(root,{probe=fetch}={}) {
  let content='';try{content=await readFile(path.join(root,'.env'),'utf8');}catch{/* Not installed yet. */}
  const values=Object.fromEntries(content.split(/\r?\n/).map(line=>line.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(([,key,value])=>[key,value.trim().replace(/^['"]|['"]$/g,'')]));
  const port=Number(values.APP_PORT||3100);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('APP_PORT inválida. Corrija apenas a porta local antes de continuar.');
  const origin=`http://127.0.0.1:${port}`;
  const profile=await jsonFile(path.join(root,'config/business.json'));
  const chromePaths=[process.env.ProgramFiles,process.env.LOCALAPPDATA,process.env['ProgramFiles(x86)']].filter(Boolean).map(base=>path.join(base,'Google/Chrome/Application/chrome.exe'));
  const checks={node24:process.versions.node.split('.')[0]==='24',env:await exists(path.join(root,'.env')),businessFile:Boolean(profile),dependencies:await exists(path.join(root,'node_modules/@modelcontextprotocol/sdk/package.json')),build:await exists(path.join(root,'.next/BUILD_ID')),chromeInstalled:(await Promise.all(chromePaths.map(exists))).some(Boolean)};
  const configured={persona:Boolean(profile?.OWNER_NAME&&profile?.COMPANY_NAME&&profile?.GEOGRAPHY),instagramToken:Boolean(values.INSTAGRAM_PAGE_ACCESS_TOKEN),openaiKey:Boolean(values.OPENAI_API_KEY),vendusWebhook:Boolean(values.VENDUS_WEBHOOK_URL)};
  /** @type {{state:string,workerOnline:boolean,paused:boolean|null}} */
  let service={state:'stopped',workerOnline:false,paused:null};
  try{
    const response=await probe(`${origin}/api/status`,{signal:AbortSignal.timeout(4000)});
    if(!response.ok)service={...service,state:'occupied_or_unverified'};
    else{
      const status=await response.json();
      if(status.installationId!==installationId(root))service={...service,state:'occupied_or_unverified'};
      else service={state:'this_installation',workerOnline:status.workerOnline===true,paused:status.paused===true};
    }
  }catch(error){if(error.cause?.code!=='ECONNREFUSED')service={...service,state:'occupied_or_unverified'};}
  return {version:(await jsonFile(path.join(root,'release.json')))?.version||'1.1.0',origin,checks,configured,service,browserControl:{state:'must_verify_in_assistant',instruction:'Chrome instalado não comprova controle. O assistente deve abrir o painel com sua ferramenta de navegador e ler um elemento visível.'},externalValidation:{meta:'not_verified_by_local_preflight',openai:'not_verified_by_local_preflight',pilot:'requires_operator_authorization'},nextStep:service.state==='occupied_or_unverified'?'Identificar o serviço da porta; não modificar nem encerrar outra instalação.':!checks.dependencies||!checks.build||!checks.env||!checks.businessFile?'Executar --bootstrap.':'Abrir o painel com a ferramenta de navegador e seguir CONFIGURACAO-ASSISTIDA.txt.'};
}
async function run(root,script,args=[]) {
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'scripts',script),...args],{cwd:root,stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`A etapa ${script} falhou (${code}).`)));});
}
export async function bootstrap(root,{inspect=inspectInstallation,execute=run}={}) {
  let state=await inspect(root);
  if(!state.checks.node24)throw new Error('Instale Node.js 24.x pelo site oficial.');
  if(state.service.state==='occupied_or_unverified')throw new Error('Porta ocupada ou serviço não identificado. Nenhuma instalação foi alterada.');
  const needsInstall=!state.checks.dependencies||!state.checks.build||!state.checks.env||!state.checks.businessFile;
  if(needsInstall){
    if(state.service.state==='this_installation')throw new Error('Esta instalação está em execução e incompleta. Planeje a parada antes de reinstalar.');
    await execute(root,'partner-verify.mjs');await execute(root,'partner-install.mjs');
  }
  if(state.service.state==='stopped')await execute(root,'partner-service.mjs',['start']);
  for(let attempt=0;attempt<25;attempt++){
    state=await inspect(root);
    if(state.service.state==='this_installation'&&state.service.workerOnline)break;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(state.service.state!=='this_installation'||!state.service.workerOnline)throw new Error('Painel/worker ainda não confirmados. Consulte o diagnóstico local antes de continuar.');
  await execute(root,'partner-doctor.mjs');return state;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=fileURLToPath(new URL('../',import.meta.url));
  try{console.log(JSON.stringify(process.argv.includes('--bootstrap')?await bootstrap(root):await inspectInstallation(root),null,2));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
