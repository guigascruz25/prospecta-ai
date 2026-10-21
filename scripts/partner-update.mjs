import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {REPOSITORY,exists,readJson,writeJson,safeChild,managed,parseManifest,verifyTree,noLinks,run,ghPath,ghJson,releaseInfo,alive} from './partner-update-lib.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function readEnvironment(root){const text=await fs.readFile(path.join(root,'.env'),'utf8');return Object.fromEntries(text.split(/\r?\n/).map(l=>l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(([,k,v])=>[k,v.trim().replace(/^['"]|['"]$/g,'')]));}
export function rootId(root){return createHash('sha256').update(path.resolve(root).replaceAll('\\','/').toLowerCase()).digest('hex').slice(0,20);}
export async function snapshotFiles(root,backup,names){const files=[];for(const name of names){if(name!=='SHA256SUMS.txt'&&!managed(name))throw new Error('Arquivo não gerenciado.');await noLinks(root,name);const target=safeChild(root,name),present=await exists(target);files.push({name,present});if(present){const dest=safeChild(path.join(backup,'code'),name);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(target,dest);}}
  await writeJson(path.join(backup,'files.json'),files);return files;}
export async function replaceManaged(root,stage,files,incoming){const fresh=new Set(incoming.map(e=>e.name).concat('SHA256SUMS.txt'));for(const file of files){await noLinks(root,file.name);const target=safeChild(root,file.name);if(fresh.has(file.name)){await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(safeChild(stage,file.name),target);}else if(file.present)await fs.unlink(target);}}
export async function restoreCode(root,backup){const files=await readJson(path.join(backup,'files.json'));if(!Array.isArray(files))throw new Error('Backup de código não encontrado.');for(const file of files){if(file.name!=='SHA256SUMS.txt'&&!managed(file.name))throw new Error('Backup inválido.');await noLinks(root,file.name);const target=safeChild(root,file.name);if(file.present){await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(safeChild(path.join(backup,'code'),file.name),target);}else await fs.unlink(target).catch(error=>{if(error.code!=='ENOENT')throw error;});}}
// pnpm uses absolute directory junctions on Windows. Rebase them after staging moves.
export async function relocateRuntime(directory,from,to){
  for(const item of await fs.readdir(directory,{withFileTypes:true})){
    const file=path.join(directory,item.name);
    if(item.isSymbolicLink()){
      const target=await fs.readlink(file);const resolved=path.resolve(path.dirname(file),target);const relative=path.relative(from,resolved);
      if(path.isAbsolute(target)&&relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)){await fs.unlink(file);await fs.symlink(path.join(to,relative),file,'junction');}
    }else if(item.isDirectory())await relocateRuntime(file,from,to);
    else if(path.basename(directory)==='.bin'&&(await fs.stat(file)).size<2000000){const text=await fs.readFile(file,'utf8');const next=text.replaceAll(from,to).replaceAll(from.replaceAll('\\','/'),to.replaceAll('\\','/'));if(next!==text)await fs.writeFile(file,next);}
  }
}
export async function executeUpdate(root,ticket,action,tag,deps={}){
  root=path.resolve(root);let state=await readJson(path.join(root,'updates/state.json'),{});const statePath=path.join(root,'updates/state.json');const lockPath=path.join(root,'updates/lock.json');
  async function phase(name,message,extra={}){state={...state,...extra,phase:name,message,updatedAt:new Date().toISOString()};await writeJson(statePath,state);console.log(message);}
  let lock;for(let i=0;i<20;i++){lock=await readJson(lockPath);if(lock?.ticket===ticket&&lock.pid===process.pid)break;await delay(100);}if(lock?.ticket!==ticket||lock.pid!==process.pid)throw new Error('Atualizador sem autorização local válida.');
  const environment=await readEnvironment(root);const port=Number(environment.APP_PORT||3100);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Porta inválida.');const origin=`http://127.0.0.1:${port}`;
  const id=rootId(root);const databaseRelative=(environment.DATABASE_URL||'data/app.db').replace(/^file:/,'');if(!databaseRelative.startsWith('data/'))throw new Error('Atualização automática exige banco dentro de data/ desta instalação.');const database=safeChild(root,databaseRelative);
  await noLinks(root,databaseRelative);
  const require=createRequire(path.join(root,'package.json'));const Database=require('better-sqlite3');
  async function status(){if(deps.status)return deps.status();const response=await fetch(`${origin}/api/status`,{signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error('Painel indisponível.');const s=await response.json();if(s.installationId!==id)throw new Error('A porta pertence a outra instalação.');return s;}
  async function stopOwned(){
    if(deps.stop)return deps.stop();
    const processes=await readJson(path.join(root,'logs/processes.json'));if(!processes||path.resolve(processes.root)!==root||!Array.isArray(processes.children))throw new Error('Não foi possível identificar os processos desta instalação.');
    const web=processes.children[0];if(!alive(web)){if(processes.children.some(alive))throw new Error('Worker ainda ativo. Aguarde antes de recuperar.');return;}
    const command=JSON.parse(String(await run('powershell.exe',['-NoProfile','-Command',`[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); Get-CimInstance Win32_Process -Filter 'ProcessId=${web}' | Select-Object -ExpandProperty CommandLine | ConvertTo-Json`],{timeout:10000})));
    if(!command?.toLowerCase().includes(path.join(root,'node_modules','next','dist','bin','next').toLowerCase()))throw new Error('O processo não pertence ao painel desta pasta.');
    process.kill(web,'SIGTERM');for(let i=0;i<100;i++){if(![processes.launcher,...processes.children].some(alive))return;await delay(200);}throw new Error('Os processos ainda não encerraram. Nenhuma troca de arquivos foi feita.');
  }
  async function startAndCheck(){if(deps.start)return deps.start();await run(process.execPath,[path.join(root,'scripts/partner-service.mjs'),'start'],{cwd:root,timeout:15000});for(let i=0;i<60;i++){try{const s=await status();if(s.workerOnline&&s.paused===true)return s;}catch{}await delay(1000);}throw new Error('A versão não confirmou painel e worker pausados.');}
  async function rollback(){
    await phase('rolling_back','Restaurando a versão e o banco anteriores.');const backup=safeChild(root,state.backupRelative);await stopOwned();await restoreCode(root,backup);
    for(const name of ['node_modules','.next']){const saved=path.join(backup,'runtime',name);if(await exists(saved)){if(await exists(path.join(root,name)))await fs.rename(path.join(root,name),path.join(backup,`failed-${name}-${Date.now()}`));await fs.rename(saved,path.join(root,name));}}
    // The database was backed up after all processes stopped. Preserve the failed database for diagnosis.
    if(await exists(path.join(backup,'database.db'))){for(const suffix of ['','-wal','-shm'])if(await exists(database+suffix))await fs.rename(database+suffix,path.join(backup,`failed-database-${Date.now()}${suffix||'.db'}`));await fs.copyFile(path.join(backup,'database.db'),database);}
    for(const [name,file] of [['.env','environment.local'],['config/business.json','business.local.json']])if(await exists(path.join(backup,file)))await fs.copyFile(path.join(backup,file),safeChild(root,name));
    const db=new Database(database);try{db.prepare("INSERT INTO settings VALUES ('paused','true') ON CONFLICT(key) DO UPDATE SET value='true'").run();db.prepare("UPDATE settings SET value='' WHERE key IN ('worker_lease','worker_heartbeat')").run();}finally{db.close();}
    await startAndCheck();await fs.unlink(path.join(root,'updates/maintenance.json')).catch(()=>{});await phase('rolled_back','Versão anterior restaurada. A fila permanece pausada.',{backupReady:false});
  }
  let changed=false;
  try{
    if(action==='recover'){if(state.backupReady)await rollback();else{await fs.unlink(path.join(root,'updates/maintenance.json')).catch(()=>{});try{await status();}catch{await startAndCheck();}await phase('rolled_back','Preparação interrompida cancelada. A instalação original foi preservada.');}return;}
    const release=releaseInfo(await (deps.query||ghJson)(`repos/${REPOSITORY}/releases/tags/${tag}`),(await readJson(path.join(root,'release.json')))?.version||'1.1.0');if(!release.available||release.tag!==tag)throw new Error('A versão aprovada não está mais disponível para esta instalação.');
    const workRelative=`updates/work/${ticket}`;const work=safeChild(root,workRelative);await fs.mkdir(work,{recursive:true});const zip=path.join(work,'release.zip');
    await phase('downloading','Baixando o pacote da Release aprovada.',{version:release.version});if(deps.download)await deps.download(zip);else await run(await ghPath(),['api','--hostname','github.com',`repos/${REPOSITORY}/releases/assets/${release.assetId}`,'-H','Accept: application/octet-stream'],{outputFile:zip,timeout:180000,maxBytes:30*1024*1024});
    await phase('validating','Conferindo origem, integridade e arquivos do pacote.');const bytes=await fs.readFile(zip);if(bytes.length!==release.size||createHash('sha256').update(bytes).digest('hex')!==release.digest)throw new Error('O pacote baixado não corresponde ao checksum da Release.');
    if(deps.extract)await deps.extract(path.join(work,'extracted'));else await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./partner-update-extract.ps1',import.meta.url)),'-Archive',zip,'-Destination',path.join(work,'extracted')],{timeout:30000});const stage=path.join(work,'extracted','Prospecta-AI');const incoming=await verifyTree(stage);const metadata=await readJson(path.join(stage,'release.json'));if(metadata.version!==release.version)throw new Error('A versão interna difere da Release.');
    await phase('preparing','Preparando dependências e compilação sem alterar sua instalação.');const cleanEnv={...process.env};for(const key of Object.keys(environment))delete cleanEnv[key];for(const key of ['GH_TOKEN','GITHUB_TOKEN','NODE_OPTIONS'])delete cleanEnv[key];
    if(deps.prepare)await deps.prepare(stage);else await run(process.execPath,[path.join(stage,'scripts/partner-install.mjs')],{cwd:stage,env:cleanEnv,timeout:1200000,maxBytes:8*1024*1024});
    const existing=await exists(path.join(root,'SHA256SUMS.txt'))?parseManifest(await fs.readFile(path.join(root,'SHA256SUMS.txt'),'utf8')):[];const names=[...new Set([...incoming,...existing].map(e=>e.name).concat('SHA256SUMS.txt'))];for(const name of names)await noLinks(root,name);
    await status();await writeJson(path.join(root,'updates/maintenance.json'),{ticket,createdAt:new Date().toISOString()});
    await phase('waiting','Pausando a fila e aguardando as tarefas em andamento terminarem.');if(deps.pause)await deps.pause();else{const pause=await fetch(`${origin}/api/control`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'pause'}),signal:AbortSignal.timeout(10000)});if(!pause.ok)throw new Error('Não foi possível pausar a operação.');}
    let idle=false;for(let i=0;i<120;i++){const s=await status();if(s.paused&&!s.jobs.some(j=>j.status==='processing')&&!s.capture.runs.some(r=>r.status==='processing')){idle=true;break;}await delay(1000);}if(!idle)throw new Error('Ainda há tarefa em andamento. Aguarde e tente atualizar novamente.');
    await stopOwned();await phase('backup','Criando backup local do banco, configurações e código.');const backupRelative=`updates/backups/${ticket}`;const backup=safeChild(root,backupRelative);await fs.mkdir(path.join(backup,'runtime'),{recursive:true});
    const db=new Database(database);try{if(db.prepare("SELECT value FROM settings WHERE key='paused'").get()?.value!=='true')throw new Error('A fila precisa estar pausada.');await db.backup(path.join(backup,'database.db'));}finally{db.close();}
    await fs.copyFile(path.join(root,'.env'),path.join(backup,'environment.local'));if(await exists(path.join(root,'config/business.json')))await fs.copyFile(path.join(root,'config/business.json'),path.join(backup,'business.local.json'));
    const files=await snapshotFiles(root,backup,names);await phase('installing','Aplicando a nova versão. O painel será reiniciado.',{backupRelative,backupReady:true});changed=true;
    for(const name of ['node_modules','.next']){await fs.rename(path.join(root,name),path.join(backup,'runtime',name));await fs.rename(path.join(stage,name),path.join(root,name));}
    await relocateRuntime(path.join(root,'node_modules'),stage,root);
    await replaceManaged(root,stage,files,incoming);await phase('restarting','Reiniciando e verificando painel, banco e worker.');const healthy=await startAndCheck();if(healthy.appVersion!==release.version)throw new Error('A versão iniciada não corresponde ao pacote.');
    await fs.unlink(path.join(root,'updates/maintenance.json'));await phase('completed','Atualização concluída. Seus dados foram preservados; a fila permanece pausada.',{backupReady:false});
  }catch{
    if(changed||action==='recover'){try{await rollback();}catch{await phase('recovery_required','Não foi possível concluir a recuperação automática. Use Recuperar versão anterior; mantenha a fila pausada.');}}
    else{await fs.unlink(path.join(root,'updates/maintenance.json')).catch(()=>{});await phase('failed','Atualização não concluída. A versão anterior foi preservada. Confira acesso ao GitHub, espaço em disco e compatibilidade do pacote.');try{await status();}catch{try{await startAndCheck();}catch{}}}
  }finally{const last=await readJson(lockPath);if(last?.ticket===ticket)await fs.unlink(lockPath).catch(()=>{});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  executeUpdate(process.argv[2],process.argv[3],process.argv[4],process.argv[5]).catch(async()=>{const root=process.argv[2],state=await readJson(path.join(root,'updates/state.json'),{});await writeJson(path.join(root,'updates/state.json'),{...state,phase:state.backupReady?'recovery_required':'failed',message:'O diagnóstico inicial impediu a atualização. Consulte a recuperação antes de alterar esta instalação.',updatedAt:new Date().toISOString()});const lock=await readJson(path.join(root,'updates/lock.json'));if(lock?.ticket===process.argv[3])await fs.unlink(path.join(root,'updates/lock.json')).catch(()=>{});process.exitCode=1;});
}
