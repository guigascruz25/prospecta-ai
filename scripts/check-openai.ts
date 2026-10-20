import { mkdirSync, writeFileSync } from 'node:fs';
import OpenAI from 'openai';
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';
import { env } from '../src/lib/config';
import { sqlite } from '../src/db';
import { reserveBudget } from '../src/features/budget';

const client=new OpenAI({apiKey:env.OPENAI_API_KEY,maxRetries:0,timeout:20000});
const id=reserveBudget(null,env.OPENAI_MODEL_FAST,512,128);
try {
  const result=await client.responses.parse({model:env.OPENAI_MODEL_FAST,input:'Connection check. Return ok=true in the requested schema.',store:false,max_output_tokens:128,text:{format:zodTextFormat(z.object({ok:z.boolean()}),'connection_check')}});
  const input=result.usage?.input_tokens||512;
  const output=result.usage?.output_tokens||128;
  const cost=(input*env.OPENAI_INPUT_USD_PER_MILLION+output*env.OPENAI_OUTPUT_USD_PER_MILLION)/1000000;
  sqlite.prepare('UPDATE ai_calls SET input_tokens=?,output_tokens=?,estimated_cost=? WHERE id=?').run(input,output,cost,id);
  if(result.output_parsed?.ok!==true) throw new Error('O modelo não confirmou a resposta estruturada.');
  const evidence={ok:true,model:result.model,inputTokens:input,outputTokens:output,estimatedCost:cost,checkedAt:new Date().toISOString()};
  mkdirSync('logs/qa',{recursive:true});
  writeFileSync('logs/qa/openai-check.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
} catch(error) {
  if(error instanceof OpenAI.APIError) console.error(JSON.stringify({ok:false,status:error.status,code:error.code}));
  else console.error('Não foi possível validar a conexão de IA.');
  process.exitCode=1;
} finally {sqlite.close();}
