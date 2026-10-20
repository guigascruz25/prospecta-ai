import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { env, getBusiness } from '../src/lib/config';
import { graph } from '../src/integrations/instagram';
import { sqlite } from '../src/db';
import { setSetting } from '../src/features/crm';

try {
  const account=z.object({id:z.string(),user_id:z.string(),username:z.string()}).parse(await graph(`${env.INSTAGRAM_BUSINESS_ACCOUNT_ID}?fields=id,user_id,username`));
  if(account.user_id!==env.INSTAGRAM_BUSINESS_ACCOUNT_ID || account.username.toLowerCase()!==getBusiness().INSTAGRAM_HANDLE.replace(/^@/,'').toLowerCase()) throw new Error('A conta autorizada não corresponde ao Instagram configurado.');
  const inbox=z.object({data:z.array(z.object({id:z.string(),participants:z.object({data:z.array(z.object({id:z.string(),username:z.string().optional()}))})}))}).parse(await graph(`${env.INSTAGRAM_BUSINESS_ACCOUNT_ID}/conversations?platform=instagram&fields=id,updated_time,participants&limit=1`));
  // Exercise the same message endpoints as the poller, without logging message bodies.
  if(inbox.data[0]) {
    const thread=z.object({messages:z.object({data:z.array(z.object({id:z.string(),created_time:z.string()}))})}).parse(await graph(`${encodeURIComponent(inbox.data[0].id)}?fields=messages.limit(20)`));
    if(thread.messages.data[0]) z.object({id:z.string(),created_time:z.string(),from:z.object({id:z.string()}),to:z.object({data:z.array(z.object({id:z.string()}))})}).parse(await graph(`${encodeURIComponent(thread.messages.data[0].id)}?fields=id,created_time,from,to,message`));
  }
  const evidence={ok:true,username:account.username,apiVersion:env.INSTAGRAM_GRAPH_VERSION,conversationsReadable:true,messageDetailsReadable:true,inboundMode:env.INSTAGRAM_INBOUND_MODE,checkedAt:new Date().toISOString()};
  setSetting('instagram_connection_verified_at',evidence.checkedAt);
  const configuration=readFileSync('.env','utf8');
  writeFileSync('.env', /^INSTAGRAM_SCOPED_ACCOUNT_ID=.*$/m.test(configuration)?configuration.replace(/^INSTAGRAM_SCOPED_ACCOUNT_ID=.*$/m,`INSTAGRAM_SCOPED_ACCOUNT_ID=${account.id}`):`${configuration.trimEnd()}\nINSTAGRAM_SCOPED_ACCOUNT_ID=${account.id}\n`,{mode:0o600});
  mkdirSync('logs/qa',{recursive:true});
  writeFileSync('logs/qa/instagram-check.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
} catch(error) {
  console.error(error instanceof z.ZodError?'A API retornou um formato inesperado.':error instanceof Error?error.message:'Falha na conexão Instagram.');
  process.exitCode=1;
} finally {sqlite.close();}
