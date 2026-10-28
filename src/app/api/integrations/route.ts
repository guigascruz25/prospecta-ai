import {NextResponse} from 'next/server';
import {existsSync} from 'node:fs';
import {z} from 'zod';
import {safeIntegrationSettings,saveIntegrationSettings,integrationSaveSchema} from '../../../features/integration-settings';
import {deliverWebhook,webhookPayload,webhookHistory} from '../../../features/outbound-webhook';
import {event} from '../../../features/crm';
export const runtime='nodejs';
export const dynamic='force-dynamic';
function local(request:Request,write=false){try{const host=request.headers.get('host')||'';const target=new URL(`http://${host}`);if(!['127.0.0.1','localhost','[::1]'].includes(target.hostname))return false;if(!write)return true;const origin=new URL(request.headers.get('origin')||'');return origin.host===host&&['127.0.0.1','localhost','[::1]'].includes(origin.hostname);}catch{return false;}}
export async function GET(request:Request){if(!local(request))return NextResponse.json({error:'Acesso apenas local.'},{status:403});try{return NextResponse.json({...safeIntegrationSettings(),deliveries:webhookHistory()},{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'Confira as configurações locais de integração.'},{status:400});}}
export async function POST(request:Request){
  if(!local(request,true))return NextResponse.json({error:'Origem não autorizada.'},{status:403});
  if(existsSync('updates/maintenance.json'))return NextResponse.json({error:'Atualização em andamento. Aguarde para alterar integrações.'},{status:423});
  try {
    const text=await request.text();if(Buffer.byteLength(text)>32000)return NextResponse.json({error:'Dados excedem o limite.'},{status:413});
    const value=z.object({action:z.enum(['save','preview','test','send']),leadId:z.string().uuid().optional()}).passthrough().parse(JSON.parse(text));
    if(value.action==='save'){const input=integrationSaveSchema.parse(value);saveIntegrationSettings(input.section,input.values,input.clearSecrets);event(null,'integration_updated',`Configuração de ${input.section} salva pelo operador.`);return NextResponse.json({ok:true});}
    safeIntegrationSettings();
    if(value.action==='preview')return NextResponse.json({payload:webhookPayload(value.leadId)});
    if(value.action==='send'&&!value.leadId)throw new Error('Selecione o lead antes de enviar.');
    return NextResponse.json(await deliverWebhook(value.action==='send'?value.leadId:undefined));
  }catch(error){const message=error instanceof z.ZodError?'Confira os campos informados.':error instanceof Error?error.message:'Não foi possível salvar a integração.';return NextResponse.json({error:message},{status:400});}
}
