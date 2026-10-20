import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {generateMcpFiles} from './partner-mcp-config.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
if(Number(process.versions.node.split('.')[0])!==24)throw new Error('Instale Node.js 24.x pelo site oficial https://nodejs.org/ e abra este instalador novamente.');
async function copyOnce(from,to){try{await access(to);console.log(`Preservado: ${to}`);}catch{await writeFile(to,await readFile(from),{flag:'wx',mode:0o600});console.log(`Criado: ${to}`);}}
for(const dir of ['config','data','logs','backups','mcp'])await mkdir(dir,{recursive:true});
await copyOnce('.env.example','.env');await copyOnce('config/business.example.json','config/business.json');
await generateMcpFiles(root);
if(!process.argv.includes('--prepare-only')) {
  const npmCli=path.resolve(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
  await access(npmCli).catch(()=>{throw new Error('npm não localizado junto ao Node.js. Reinstale Node.js 24.x com npm.');});
  const version=JSON.parse(await readFile('package.json','utf8')).packageManager;
  async function pnpm(args){console.log(`\nInstalação: pnpm ${args.join(' ')}`);await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[npmCli,'exec','--yes',`--package=${version}`,'--','pnpm',...args],{cwd:root,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Falha na etapa: ${args[0]}. Código ${code}.`)));});}
  await pnpm(['install','--frozen-lockfile','--ignore-scripts']);
  // This pinned SQLite release ships platform binaries. Avoid pnpm's fallback node-gyp
  // lifecycle and verify the actual native module instead of requiring Visual Studio.
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['-e',"const Database=require('better-sqlite3');const db=new Database(':memory:');if(db.prepare('SELECT 1 AS ok').get().ok!==1)process.exit(1);db.close();console.log('SQLite pré-compilado conferido.');"],{cwd:root,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('SQLite incompatível com este Node/sistema. Use Node.js 24.x no Windows compatível; consulte o suporte antes de instalar compiladores.')));});
  await pnpm(['build']);
}
console.log('\nProspecta AI preparado. Abra COMECE-AQUI.html e siga a aula 1.');
console.log('Instalação nova: simulação, credenciais vazias e envios desativados. Arquivos existentes são preservados.');
console.log('Este instalador não registra serviços no Windows, não altera perfis globais dos assistentes e não inicia mensagens.');
