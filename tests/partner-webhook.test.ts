import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {exportResearch} from '../scripts/partner-webhook.mjs';
async function cleanup(directory:string){assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert.match(path.basename(directory),/^prospecta-webhook-/);await rm(directory,{recursive:true});}
const rows=[{id:'lote-teste:001',name:'Empresa de teste',sourceUrl:'https://example.com',overview:'Empresa pesquisada em fonte pública.'}];
const url='https://app.vendus.com.br/functions/v1/webhook-receiver/00000000-0000-0000-0000-000000000000';
test('webhook export defaults to preview and requires destination confirmation',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'prospecta-webhook-'));
  try {let calls=0;const fetcher=async()=>{calls++;return new Response('{}');};assert.equal((await exportResearch(rows,{directory,fetcher})).sent,0);await assert.rejects(exportResearch(rows,{directory,fetcher,send:true,url}));assert.equal(calls,0);}finally{await cleanup(directory);}
});
test('webhook receipts prevent duplicate sends, including uncertain delivery',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'prospecta-webhook-'));
  try {let calls=0;const fetcher=async()=>{calls++;throw new Error('Network interrupted');};const first=await exportResearch(rows,{directory,fetcher,send:true,url,confirmed:true});assert.equal(first.receipts![0].outcome,'unknown');const second=await exportResearch(rows,{directory,fetcher,send:true,url,confirmed:true});assert.equal(second.receipts![0].outcome,'already_attempted');assert.equal(calls,1);}finally{await cleanup(directory);}
});
