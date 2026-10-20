import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {inspectInstallation,installationId,bootstrap} from '../scripts/partner-onboarding.mjs';
async function fixture(run:(root:string)=>Promise<void>){const root=await mkdtemp(path.join(tmpdir(),'prospecta-setup-'));try{await run(root);}finally{const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(tmpdir()));assert(path.basename(resolved).startsWith('prospecta-setup-'));await rm(resolved,{recursive:true,force:true});}}
test('setup distinguishes this installation from an unrelated service and never reports browser/API validation from presence',async()=>fixture(async root=>{
  await mkdir(path.join(root,'config'));
  await writeFile(path.join(root,'.env'),'APP_PORT=3113\nOPENAI_API_KEY=private-fixture-value\nINSTAGRAM_PAGE_ACCESS_TOKEN=another-private-fixture\n');
  await writeFile(path.join(root,'config/business.json'),JSON.stringify({OWNER_NAME:'Ana',COMPANY_NAME:'Exemplo',GEOGRAPHY:'Campinas'}));
  const report=await inspectInstallation(root,{probe:async()=>new Response(JSON.stringify({installationId:installationId(root),workerOnline:true,paused:true}))});
  assert.equal(report.service.state,'this_installation');assert.equal(report.configured.openaiKey,true);assert.equal(report.configured.persona,true);
  assert.equal(report.browserControl.state,'must_verify_in_assistant');assert.equal(report.externalValidation.openai,'not_verified_by_local_preflight');
  assert(!JSON.stringify(report).includes('private-fixture'));
  const foreign=await inspectInstallation(root,{probe:async()=>new Response(JSON.stringify({installationId:'other',workerOnline:true}))});assert.equal(foreign.service.state,'occupied_or_unverified');
  assert.equal(await readFile(path.join(root,'.env'),'utf8'),'APP_PORT=3113\nOPENAI_API_KEY=private-fixture-value\nINSTAGRAM_PAGE_ACCESS_TOKEN=another-private-fixture\n');
}));
test('bootstrap refuses a foreign occupied port before running any mutation',async()=>fixture(async root=>{
  let calls=0;
  const base=await inspectInstallation(root,{probe:async()=>new Response('{}')});
  await assert.rejects(bootstrap(root,{inspect:async()=>({...base,checks:{...base.checks,node24:true},service:{...base.service,state:'occupied_or_unverified'}}),execute:async()=>{calls++;}}),/Porta ocupada/);
  assert.equal(calls,0);
}));
test('bootstrap reuses an existing ready server and does not reinstall, restart or resume it',async()=>fixture(async root=>{
  const calls:string[]=[];
  const base=await inspectInstallation(root,{probe:async()=>new Response('{}')});
  const state={...base,checks:{...base.checks,node24:true,dependencies:true,build:true,env:true,businessFile:true},service:{state:'this_installation',workerOnline:true,paused:true}};
  const result=await bootstrap(root,{inspect:async()=>state,execute:async(_root:string,script:string)=>{calls.push(script);}});
  assert.deepEqual(calls,['partner-doctor.mjs']);assert.equal(result.service.paused,true);
}));
