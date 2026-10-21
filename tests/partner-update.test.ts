import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {safeChild,parseManifest,compareVersion,verifyTree,claimUpdate,writeJson,readJson,releaseInfo,updateView,REPOSITORY} from '../scripts/partner-update-lib.mjs';
import {executeUpdate,relocateRuntime} from '../scripts/partner-update.mjs';
const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
async function fixture(fn:(base:string)=>Promise<void>){const parent=path.resolve('outputs/update-tests');await fs.mkdir(parent,{recursive:true});const base=await fs.mkdtemp(path.join(parent,'test-'));try{await fn(base);}finally{assert.equal(path.dirname(path.resolve(base)),parent);assert(path.basename(base).startsWith('test-'));await fs.rm(base,{recursive:true,force:true});}}
async function put(root:string,name:string,text:string){const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,text);}
async function packageFixture(root:string){const files:Record<string,string>={'release.json':JSON.stringify({version:'1.2.0',repository:REPOSITORY,updateFormat:1}),'package.json':'{"version":"1.2.0","type":"module"}','scripts/run.mjs':'// fresh','scripts/partner-install.mjs':'// installer','scripts/partner-update.mjs':'// updater','src/new.ts':'export const value=2;'};for(const [n,v] of Object.entries(files))await put(root,n,v);await put(root,'SHA256SUMS.txt',Object.entries(files).map(([n,v])=>`${hash(v)}  ${n}`).join('\n'));}
test('updater rejects traversal, Windows special paths, private data and duplicate manifests',()=>{
 for(const name of ['../.env','/tmp/file','src/../../.env','src\\a.ts','src/a:stream','src/CON.txt','src/a.'])assert.throws(()=>safeChild('.',name));
 for(const name of ['.env','config/business.json','data/app.db','public/pesquisa-patos/dados.json','updates/state.json'])assert.throws(()=>parseManifest(`${'a'.repeat(64)}  ${name}`));
 assert.throws(()=>parseManifest(`${'a'.repeat(64)}  src/a.ts\n${'a'.repeat(64)}  SRC/A.ts`));
 assert.equal(compareVersion('1.10.0','1.9.9'),1);assert.equal(compareVersion('v1.2.0','1.2.0'),0);assert.throws(()=>compareVersion('1.2.0-rc','1.1.0'));
});
test('release metadata rejects drafts, bad digests, missing assets and non-upgrades',()=>{
 const release={tag_name:'v1.2.0',assets:[{id:12,state:'uploaded',name:'Prospecta-AI-Parceiros-1.2.0.zip',size:50,digest:'sha256:'+hash('zip')}]};
 assert.equal(releaseInfo(release,'1.1.0').available,true);assert.equal(releaseInfo(release,'1.2.0').available,false);
 assert.throws(()=>releaseInfo({...release,draft:true},'1.1.0'));assert.throws(()=>releaseInfo({...release,assets:[]},'1.1.0'));
 assert.throws(()=>releaseInfo({...release,assets:[{...release.assets[0],digest:'md5:bad'}]},'1.1.0'));
});
test('manifest validates every file and refuses unlisted content or tampering',async()=>fixture(async root=>{
 await packageFixture(root);assert.equal((await verifyTree(root)).length,6);await put(root,'src/new.ts','changed');await assert.rejects(verifyTree(root),/integridade/);await put(root,'src/new.ts','export const value=2;');await put(root,'data/private.json','{}');await assert.rejects(verifyTree(root),/fora do manifesto/);
}));
test('lock blocks concurrent updates and interrupted maintenance offers recovery',async()=>fixture(async root=>{
 const ticket=await claimUpdate(root);assert(ticket);await assert.rejects(claimUpdate(root),/andamento/);
 await writeJson(path.join(root,'updates/lock.json'),{ticket,pid:99999999});await writeJson(path.join(root,'updates/state.json'),{phase:'backup',backupReady:false});await writeJson(path.join(root,'updates/maintenance.json'),{});
 const v=await updateView(root);assert.equal(v.busy,false);assert.equal(v.state?.phase,'interrupted');assert.equal(v.recoverable,true);
}));
async function transactionFixture(base:string,failStart=false,badDigest=false){
 const root=path.join(base,'installation'),source=path.join(base,'published');await fs.mkdir(root);await packageFixture(source);
 await put(root,'package.json','{"version":"1.1.0","type":"module"}');await put(root,'release.json',JSON.stringify({version:'1.1.0',repository:REPOSITORY,updateFormat:1}));await put(root,'scripts/run.mjs','// old');await put(root,'src/removed.ts','old managed code');await put(root,'SHA256SUMS.txt',`${hash('old managed code')}  src/removed.ts`);
 await put(root,'.env','APP_PORT=3199\nDATABASE_URL=data/app.db\nPRIVATE_TEST_KEY=keep-private\n');await put(root,'config/business.json','{"COMPANY_NAME":"Fixture"}');await put(root,'public/pesquisa-patos/dados.json','private research');await put(root,'.chrome-profile/session','private session');await put(root,'node_modules/old-marker','old dependencies');await put(root,'.next/BUILD_ID','old build');
 await fs.mkdir(path.join(root,'data'),{recursive:true});const db=new Database(path.join(root,'data/app.db'));db.exec("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT); INSERT INTO settings VALUES('paused','true'); CREATE TABLE leads(id TEXT); INSERT INTO leads VALUES('kept');");db.close();
 const ticket=await claimUpdate(root);await writeJson(path.join(root,'updates/lock.json'),{ticket,pid:process.pid});await writeJson(path.join(root,'updates/state.json'),{phase:'requested'});
 const zipped=Buffer.from('fixture-archive');let starts=0,stops=0;
 await executeUpdate(root,ticket,'install','v1.2.0',{
  query:async()=>({tag_name:'v1.2.0',assets:[{id:1,state:'uploaded',name:'Prospecta-AI-Parceiros-1.2.0.zip',size:zipped.length,digest:'sha256:'+hash(zipped)}]}),
  download:async(file:string)=>{await fs.writeFile(file,badDigest?'corrupt':zipped);},extract:async(dir:string)=>{await fs.cp(source,path.join(dir,'Prospecta-AI'),{recursive:true});},
  prepare:async(stage:string)=>{await put(stage,'node_modules/new-marker','new dependencies');await put(stage,'.next/BUILD_ID','new build');},
  status:async()=>({paused:true,jobs:[],capture:{runs:[]}}),pause:async()=>{},stop:async()=>{stops++;},
  start:async()=>{starts++;if(failStart&&starts===1){const migrated=new Database(path.join(root,'data/app.db'));migrated.exec("INSERT INTO leads VALUES('failed-migration');");migrated.close();throw new Error('Injected unhealthy start');}return {paused:true,workerOnline:true,appVersion:'1.2.0'};}
 });
 assert.equal(await fs.readFile(path.join(root,'.env'),'utf8'),'APP_PORT=3199\nDATABASE_URL=data/app.db\nPRIVATE_TEST_KEY=keep-private\n');assert.equal(await fs.readFile(path.join(root,'public/pesquisa-patos/dados.json'),'utf8'),'private research');assert.equal(await fs.readFile(path.join(root,'.chrome-profile/session'),'utf8'),'private session');
 const kept=new Database(path.join(root,'data/app.db'));assert.deepEqual(kept.prepare('SELECT id FROM leads').all(),[{id:'kept'}]);kept.close();
 const state=await readJson(path.join(root,'updates/state.json'));assert.equal(state.phase,badDigest?'failed':failStart?'rolled_back':'completed');assert.equal((await readJson(path.join(root,'release.json'))).version,badDigest||failStart?'1.1.0':'1.2.0');
 if(badDigest){assert.equal(stops,0);assert.equal(starts,0);}else if(failStart){assert.equal(starts,2);assert.equal(await fs.readFile(path.join(root,'.next/BUILD_ID'),'utf8'),'old build');assert.equal(await fs.readFile(path.join(root,'src/removed.ts'),'utf8'),'old managed code');await assert.rejects(fs.access(path.join(root,'src/new.ts')));}else{assert.equal(starts,1);assert.equal(await fs.readFile(path.join(root,'.next/BUILD_ID'),'utf8'),'new build');await assert.rejects(fs.access(path.join(root,'src/removed.ts')));}
}
test('successful update swaps managed code/runtime and preserves all private data',async()=>fixture(base=>transactionFixture(base)));
test('unhealthy new version rolls back code, dependencies, build and database migrations',async()=>fixture(base=>transactionFixture(base,true)));
test('corrupt download never stops the running installation or changes its version',async()=>fixture(base=>transactionFixture(base,false,true)));
test('Windows pnpm junctions and command shims follow the relocated runtime',async()=>fixture(async base=>{
 const stage=path.join(base,'stage'),root=path.join(base,'root');await put(stage,'node_modules/.pnpm/example/index.js','module.exports=42;');await put(stage,'node_modules/.bin/example.cmd','SET NODE_PATH='+stage+'\\node_modules');await fs.symlink(path.join(stage,'node_modules/.pnpm/example'),path.join(stage,'node_modules/example'),'junction');await fs.mkdir(root);await fs.rename(path.join(stage,'node_modules'),path.join(root,'node_modules'));await relocateRuntime(path.join(root,'node_modules'),stage,root);assert.equal(await fs.readFile(path.join(root,'node_modules/example/index.js'),'utf8'),'module.exports=42;');assert.equal(await fs.readFile(path.join(root,'node_modules/.bin/example.cmd'),'utf8'),'SET NODE_PATH='+root+'\\node_modules');
}));
