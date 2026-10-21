import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';

export const REPOSITORY='guigascruz25/prospecta-ai';
export const ACTIVE=['requested','downloading','validating','preparing','waiting','backup','installing','restarting','rolling_back'];
export const exists=async p=>{try{await fs.access(p);return true;}catch{return false;}};
export async function readJson(p,fallback=null){try{return JSON.parse(await fs.readFile(p,'utf8'));}catch{return fallback;}}
export async function writeJson(p,value){await fs.mkdir(path.dirname(p),{recursive:true});const temp=p+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(value,null,2),{mode:0o600});await fs.rename(temp,p);}
export function safeChild(root,relative){
  if(typeof relative!=='string'||!relative||relative.includes('\\')||relative.includes(':')||relative.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw new Error('Caminho de atualização inválido.');
  const target=path.resolve(root,relative);const rel=path.relative(path.resolve(root),target);if(rel.startsWith('..')||path.isAbsolute(rel))throw new Error('Caminho fora da instalação.');return target;
}
export function managed(name){return /^(src|tests|scripts|partner-kit|aulas|exemplos)\//.test(name)||/^public\/brand\//.test(name)||name==='config/business.example.json'||new Set(['release.json','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','next.config.ts','next-env.d.ts','tsconfig.json','postcss.config.mjs','eslint.config.mjs','.gitignore','.gitattributes','.env.example','AGENTS.md','CLAUDE.md','README.md','README-PARCEIROS.txt','CONFIGURACAO-ASSISTIDA.txt','PROMPT-MESTRE.txt','PROMPT-INICIAL.txt','INTEGRACAO-VENDUS.txt','ATUALIZACOES.txt','NOTICE.txt','COMECE-AQUI.html','Instalar.cmd','Iniciar.cmd','Parar.cmd','Diagnosticar.cmd','Conectar-Instagram.cmd','Conferir-Pacote.cmd','Criar-Atalho.cmd','Atualizar.cmd']).has(name);}
export function parseManifest(text){const seen=new Set();return text.trim().split(/\r?\n/).map(line=>{const match=/^([a-f0-9]{64})  (.+)$/.exec(line);if(!match)throw new Error('Manifesto de integridade inválido.');const [,hash,name]=match;safeChild('.',name);if(!managed(name)||seen.has(name.toLowerCase()))throw new Error('Arquivo não permitido ou repetido no pacote.');seen.add(name.toLowerCase());return {hash,name};});}
export function compareVersion(a,b){const parse=s=>{if(!/^v?\d+\.\d+\.\d+$/.test(s))throw new Error('Somente versões estáveis são aceitas.');return s.replace(/^v/,'').split('.').map(Number);};const x=parse(a),y=parse(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;}
export async function noLinks(root,relative){const realRoot=await fs.realpath(root);let current=realRoot;for(const part of relative.split('/')){current=path.join(current,part);try{if((await fs.lstat(current)).isSymbolicLink())throw new Error('Links simbólicos não são aceitos na atualização.');}catch(error){if(error.code!=='ENOENT')throw error;}}}
export async function verifyTree(root){const entries=parseManifest(await fs.readFile(path.join(root,'SHA256SUMS.txt'),'utf8'));const actual=[];
  async function walk(dir,prefix=''){for(const e of await fs.readdir(dir,{withFileTypes:true})){const name=prefix+e.name;if(e.isSymbolicLink())throw new Error('Link simbólico no pacote.');if(e.isDirectory())await walk(path.join(dir,e.name),name+'/');else actual.push(name);}}
  await walk(root);const expected=new Set([...entries.map(e=>e.name),'SHA256SUMS.txt']);if(actual.length!==expected.size||actual.some(n=>!expected.has(n)))throw new Error('O pacote contém arquivos fora do manifesto.');
  for(const {name,hash} of entries){const file=safeChild(root,name);if(createHash('sha256').update(await fs.readFile(file)).digest('hex')!==hash)throw new Error('Falha de integridade no pacote.');}
  for(const required of ['release.json','package.json','scripts/run.mjs','scripts/partner-install.mjs','scripts/partner-update.mjs'])if(!expected.has(required))throw new Error('Pacote sem suporte à atualização automática.');
  const release=await readJson(path.join(root,'release.json'));if(release?.repository!==REPOSITORY||release?.updateFormat!==1)throw new Error('Pacote de outra origem ou formato.');return entries;
}
export function alive(pid){try{if(!Number.isSafeInteger(pid)||pid<1)return false;process.kill(pid,0);return true;}catch{return false;}}
export function run(command,args,{cwd,timeout=120000,outputFile,maxBytes=2000000,env=process.env}={}){
  return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});const chunks=[];let size=0,failed=false;
    function stopChild(){if(process.platform==='win32'&&child.pid){const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>child.kill());}else child.kill();}
    const timer=setTimeout(()=>{failed=true;stopChild();reject(new Error('A etapa excedeu o tempo de espera.'));},timeout);
    child.stdout.on('data',data=>{if(failed)return;size+=data.length;if(size>maxBytes){failed=true;stopChild();reject(new Error('Resposta excede o limite permitido.'));return;}chunks.push(data);});
    child.stderr.resume(); // gh/npm stderr can contain login URLs. Never forward it to the panel or logs.
    child.on('error',error=>{clearTimeout(timer);failed=true;reject(Object.assign(new Error(error.code==='ENOENT'?'GitHub CLI não encontrado. Instale pelo site oficial.':'Não foi possível executar esta etapa.'),{code:error.code}));});
    child.on('close',async code=>{clearTimeout(timer);try{if(!failed){if(code!==0)reject(new Error('Etapa não concluída. Confira acesso ao GitHub, conexão e compatibilidade do pacote.'));else{const bytes=Buffer.concat(chunks);if(outputFile)await fs.writeFile(outputFile,bytes,{flag:'wx',mode:0o600});resolve(outputFile?'':bytes.toString('utf8'));}}}catch{reject(new Error('Não foi possível gravar o pacote local.'));}});
  });
}
export async function ghPath(){if(process.platform!=='win32')throw new Error('O atualizador desta edição é para Windows.');const known=[path.join(process.env.ProgramFiles||'C:/Program Files','GitHub CLI','gh.exe'),path.join(process.env.LOCALAPPDATA||'','Programs','GitHub CLI','gh.exe')];for(const file of known)if(await exists(file))return file;try{const lines=String(await run('where.exe',['gh.exe'],{timeout:5000})).trim().split(/\r?\n/);if(lines[0]&&path.isAbsolute(lines[0]))return lines[0];}catch{}throw new Error('Instale o GitHub CLI oficial e reinicie o Prospecta AI.');}
export async function ghJson(endpoint){const gh=await ghPath();return JSON.parse(String(await run(gh,['api','--hostname','github.com',endpoint],{timeout:30000})));}
export function releaseInfo(release,current){if(release.draft||release.prerelease||!/^v\d+\.\d+\.\d+$/.test(release.tag_name))throw new Error('A Release não é uma versão estável publicada.');
  const version=release.tag_name.slice(1),name=`Prospecta-AI-Parceiros-${version}.zip`;const zip=release.assets?.find(a=>a.name===name&&a.state==='uploaded');
  if(!zip||!Number.isSafeInteger(zip.id)||!/^sha256:[a-f0-9]{64}$/.test(zip.digest||'')||zip.size>30*1024*1024)throw new Error('Release sem pacote verificado compatível.');
  return {version,tag:release.tag_name,available:compareVersion(version,current)>0,url:`https://github.com/${REPOSITORY}/releases/tag/${release.tag_name}`,notes:String(release.body||'').slice(0,12000),assetId:zip.id,digest:zip.digest.slice(7),size:zip.size,checkedAt:new Date().toISOString()};
}
export async function checkRelease(root,{force=false,query=ghJson}={}){const cacheFile=path.join(root,'updates/check.json');const cached=await readJson(cacheFile);if(!force&&cached&&Date.now()-Date.parse(cached.checkedAt)<3600000)return cached;
  const current=(await readJson(path.join(root,'release.json')))?.version||'1.1.0';let result;
  try{result={...(releaseInfo(await query(`repos/${REPOSITORY}/releases/latest`),current)),connected:true,error:''};}catch{result={connected:false,error:'Não foi possível acessar a Release privada. Instale o GitHub CLI, conecte sua conta e confira o convite ao repositório.',checkedAt:new Date().toISOString()};}
  await writeJson(cacheFile,result);return result;
}
export async function updateView(root){const [release,check,state,lock]=await Promise.all([readJson(path.join(root,'release.json')),readJson(path.join(root,'updates/check.json')),readJson(path.join(root,'updates/state.json')),readJson(path.join(root,'updates/lock.json'))]);
  const running=Boolean(lock&&alive(lock.pid));const interrupted=Boolean(state&&ACTIVE.includes(state.phase)&&!running);
  const maintenance=await exists(path.join(root,'updates/maintenance.json'));
  return {currentVersion:release?.version||'1.1.0',repository:REPOSITORY,check:check?{...check,available:check.version?compareVersion(check.version,release?.version||'1.1.0')>0:false}:null,state:state?{phase:interrupted?'interrupted':state.phase,message:interrupted?'Atualização interrompida. Consulte a recuperação antes de retomar.':state.message,version:state.version,updatedAt:state.updatedAt,backupReady:state.backupReady===true}:null,busy:running,recoverable:!running&&(state?.backupReady===true||maintenance)&&['failed','recovery_required','interrupted'].includes(interrupted?'interrupted':state?.phase),maintenance};
}
export async function claimUpdate(root){const directory=path.join(root,'updates');await fs.mkdir(directory,{recursive:true});const file=path.join(directory,'lock.json');const previous=await readJson(file);if(previous&&alive(previous.pid))throw new Error('Já existe uma atualização em andamento.');
  if(previous)await fs.unlink(file);const ticket=randomUUID();await fs.writeFile(file,JSON.stringify({ticket,pid:process.pid}),{flag:'wx',mode:0o600});return ticket;
}
export async function dispatchUpdate(root,action,tag,templateRoot=path.join(root,'scripts')){const view=await updateView(root);if(action==='install'&&view.maintenance)throw new Error('Recupere a atualização anterior antes de tentar outra.');if(action==='recover'&&!view.recoverable)throw new Error('Nenhuma recuperação pendente.');
  if(action==='install'&&(!view.check?.connected||view.check.tag!==tag||!view.check.available))throw new Error('Confira novamente a versão disponível antes de atualizar.');
  const ticket=await claimUpdate(root);let log;
  try{const helper=path.join(root,'updates','helper-'+ticket);await fs.mkdir(helper);for(const name of ['partner-update-lib.mjs','partner-update.mjs','partner-update-extract.ps1','partner-update-console.mjs'])await fs.copyFile(/* turbopackIgnore: true */ path.join(templateRoot,name),path.join(helper,name));
    await fs.writeFile(path.join(root,'updates','Recuperar.cmd'),`@echo off\r\nchcp 65001 >nul\r\npushd "%~dp0.."\r\nnode "%~dp0helper-${ticket}\\partner-update-console.mjs" "%CD%"\r\npause\r\npopd\r\n`);
    const previous=await readJson(path.join(root,'updates/state.json'));await writeJson(path.join(root,'updates/state.json'),{...(action==='recover'?previous:{}),phase:'requested',message:action==='recover'?'Recuperação solicitada.':'Preparando download da versão aprovada.',version:action==='recover'?previous?.version:tag?.slice(1),updatedAt:new Date().toISOString()});
    log=await fs.open(path.join(root,'logs/update.log'),'a',0o600);const child=spawn(process.execPath,[path.join(helper,'partner-update.mjs'),root,ticket,action,...(tag?[tag]:[])],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});await writeJson(path.join(root,'updates/lock.json'),{ticket,pid:child.pid});child.unref();return {ok:true};
  }catch{await fs.unlink(path.join(root,'updates/lock.json')).catch(()=>{});throw new Error('Não foi possível iniciar o atualizador.');}finally{await log?.close();}
}
export async function openGithubLogin(){const gh=await ghPath();const command=`& '${gh.replaceAll("'","''")}' auth login --hostname github.com --git-protocol https --web`;
  const encoded=Buffer.from(command,'utf16le').toString('base64');const child=spawn('powershell.exe',['-NoProfile','-NoExit','-EncodedCommand',encoded],{detached:true,windowsHide:false,stdio:'ignore'});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();return {ok:true};}
export async function launchIndependent(root){
  const launcher=path.join(root,'updates','launch-independent.mjs');await fs.mkdir(path.dirname(launcher),{recursive:true});
  await fs.writeFile(launcher,`import {spawn} from 'node:child_process';import fs from 'node:fs/promises';import path from 'node:path';const root=${JSON.stringify(root)};const out=await fs.open(path.join(root,'logs/app.log'),'a');const err=await fs.open(path.join(root,'logs/app-error.log'),'a');const child=spawn(process.execPath,[path.join(root,'scripts/run.mjs'),'start'],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',out.fd,err.fd]});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();await fs.writeFile(path.join(root,'logs/launcher.pid'),String(child.pid));await out.close();await err.close();`);
  // WMI starts the daemon outside the retiring updater's Windows job, with no console.
  const quote=s=>"'"+s.replaceAll("'","''")+"'";const command=`"${process.execPath}" "${launcher}"`;
  const script=`$ErrorActionPreference='Stop'; $startup=New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0;CreateFlags=[uint32]16777224}; Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=${quote(command)};CurrentDirectory=${quote(root)};ProcessStartupInformation=$startup} | Select-Object ReturnValue,ProcessId | ConvertTo-Json`;
  const result=JSON.parse(String(await run('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{cwd:root,timeout:15000})));
  if(result.ReturnValue!==0)throw new Error('O Windows impediu o reinício independente. Inicie pelo atalho após recuperar.');
}
