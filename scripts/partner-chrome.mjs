import {config} from 'dotenv';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import {exists,run,noLinks} from './partner-update-lib.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));config({path:path.join(root,'.env'),quiet:true});
const endpoint=new URL(process.env.CHROME_CDP_URL||'http://127.0.0.1:9222');
if(endpoint.protocol!=='http:'||!['localhost','127.0.0.1'].includes(endpoint.hostname)||!endpoint.port)throw new Error('Use uma porta CDP local explícita.');
const profile=path.resolve(root,process.env.CHROME_PROFILE_DIR||'.chrome-profile');const relative=path.relative(root,profile);if(relative.startsWith('..')||path.isAbsolute(relative)||!relative)throw new Error('O perfil Chrome deve ficar dentro desta instalação.');await noLinks(root,relative.replaceAll('\\','/'));
const candidates=[process.env.ProgramFiles,process.env.LOCALAPPDATA,process.env['ProgramFiles(x86)']].filter(Boolean).map(base=>path.join(base,'Google/Chrome/Application/chrome.exe'));let chrome;for(const candidate of candidates)if(await exists(candidate)){chrome=candidate;break;}if(!chrome)throw new Error('Instale o Google Chrome pelo site oficial.');
let occupied=false;try{await fetch(endpoint.origin+'/json/version',{signal:AbortSignal.timeout(1500)});occupied=true;}catch{}
if(occupied){const commands=String(await run('powershell.exe',['-NoProfile','-Command',"[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); Get-CimInstance Win32_Process -Filter \"Name = 'chrome.exe'\" | Select-Object -ExpandProperty CommandLine | ConvertTo-Json"],{timeout:10000}));const list=JSON.parse(commands||'[]');if(![list].flat().some(text=>typeof text==='string'&&text.includes(profile)&&text.includes('--remote-debugging-port='+endpoint.port)))throw new Error('A porta do Chrome está ocupada por outro perfil. Escolha outra CHROME_CDP_URL no .env.');console.log('O Chrome desta instalação já está aberto.');}
else{await fs.mkdir(profile,{recursive:true});const child=spawn(chrome,[`--remote-debugging-port=${endpoint.port}`,'--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,'--no-first-run','https://www.instagram.com/'],{detached:true,windowsHide:false,stdio:'ignore'});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();console.log('Chrome dedicado aberto. Faça login nessa janela.');}
