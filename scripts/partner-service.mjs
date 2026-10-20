import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {config} from 'dotenv';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);config({quiet:true});
const origin=`http://127.0.0.1:${process.env.APP_PORT||3100}`;
const action=process.argv[2]||'start';
if(action==='start') {
  try{await fetch(origin,{signal:AbortSignal.timeout(1200)});throw new Error(`A porta já está em uso. Confira ${origin}. Não inicie outra instalação na mesma porta.`);}catch(error){if(error.cause?.code!=='ECONNREFUSED')throw error;}
  await accessBuild();await mkdir('logs',{recursive:true});
  const out=await open('logs/app.log','a');const err=await open('logs/app-error.log','a');
  const child=spawn(process.execPath,[path.join(root,'scripts','run.mjs'),'start'],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',out.fd,err.fd]});
  child.unref();await writeFile('logs/launcher.pid',String(child.pid));await out.close();await err.close();
  console.log(`Prospecta AI iniciando: ${origin}. Use Diagnosticar.cmd para conferir.`);
}else if(action==='stop') {
  const state=JSON.parse(await readFile('logs/processes.json','utf8'));
  if(path.resolve(state.root)!==path.resolve(root))throw new Error('Registro de processos pertence a outra instalação.');
  const pause=await fetch(`${origin}/api/control`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'pause'}),signal:AbortSignal.timeout(5000)});if(!pause.ok)throw new Error('Não foi possível pausar; encerre pelo terminal que iniciou o sistema.');
  const snapshot=await(await fetch(`${origin}/api/status`)).json();
  if(snapshot.jobs.some(j=>j.status==='processing')||snapshot.capture.runs.some(r=>r.status==='processing'))throw new Error('Fila pausada. Aguarde a tarefa em andamento terminar e clique Parar novamente.');
  const webPid=state.children[0];if(!Number.isSafeInteger(webPid)||webPid<1)throw new Error('PID inválido.');
  const command=process.platform==='win32'?JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Get-CimInstance Win32_Process -Filter 'ProcessId=${webPid}' | Select-Object -ExpandProperty CommandLine | ConvertTo-Json`],{encoding:'utf8',windowsHide:true})):execFileSync('ps',['-p',String(webPid),'-o','args='],{encoding:'utf8'});
  if(!command?.includes(path.join(root,'node_modules','next','dist','bin','next')))throw new Error('PID não corresponde ao servidor desta pasta. Nenhum processo foi encerrado.');
  process.kill(webPid,'SIGTERM');console.log('Servidor encerrado. O launcher encerra o worker desta instalação.');
}else throw new Error('Use start ou stop.');
async function accessBuild(){try{await readFile('.next/BUILD_ID');}catch{throw new Error('Execute Instalar.cmd antes de iniciar.');}}
