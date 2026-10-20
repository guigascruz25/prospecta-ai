import {readFile,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {config} from 'dotenv';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {installationId} from './partner-onboarding.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);config({quiet:true});
const report={node:process.versions.node,files:{},application:null,mcp:null};
for(const file of ['.env','config/business.json','.next/BUILD_ID']){try{await access(file);report.files[file]=true;}catch{report.files[file]=false;}}
try {
  const response=await fetch(`http://127.0.0.1:${process.env.APP_PORT||3100}/api/status`,{signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error('Painel indisponível.');const value=await response.json();
  if(value.installationId!==installationId(root))throw new Error('A porta responde por outra instalação ou versão não identificada. Não altere esse serviço.');
  report.application={mode:value.mode,paused:value.paused,workerOnline:value.workerOnline,ready:value.readiness,leads:value.leads.length,followUps:value.followUps.enabled};
  const client=new Client({name:'prospecta-partner-doctor',version:'1.1.0'});
  try{await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./mcp.mjs',import.meta.url))]}));const tools=await client.listTools();const check=await client.callTool({name:'get_status',arguments:{}});if(check.isError)throw new Error('MCP não conseguiu ler o painel.');report.mcp={ok:true,tools:tools.tools.map(t=>t.name)};}finally{await client.close();}
}catch(error){report.error=error.message;}
const profile=JSON.parse(await readFile('config/business.json','utf8'));report.personaConfigured=Boolean(profile.COMPANY_NAME&&profile.OWNER_NAME&&profile.GEOGRAPHY);
report.ok=Boolean(report.application?.workerOnline&&report.mcp?.ok);
console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
