import { NextResponse } from 'next/server';
import { z } from 'zod';
import { demo, addLead, setStage, optOut, pause, setSetting, event, requestContact, receiveInbound, getLead, patchLead } from '../../../features/crm';
import { saveBusiness, readiness, env } from '../../../lib/config';
import { sendBrowserMessage } from '../../../integrations/browser';
import { verifyDiscoveredLead, queueVerifiedProspects } from '../../../features/discovery';

export const runtime = 'nodejs';
const actionSchema = z.discriminatedUnion('action', [
  z.object({action:z.literal('demo')}), z.object({action:z.literal('pause')}), z.object({action:z.literal('resume')}),
  z.object({action:z.literal('addLead'),lead:z.unknown()}), z.object({action:z.literal('business'),business:z.unknown()}),
  z.object({action:z.literal('stage'),id:z.string().uuid(),stage:z.string()}),
  z.object({action:z.literal('note'),id:z.string().uuid(),text:z.string().trim().min(1).max(3000),nextAction:z.string().max(300).optional()}),
  z.object({action:z.literal('contact'),id:z.string().uuid()}), z.object({action:z.literal('block'),id:z.string().uuid()}),
  z.object({action:z.literal('simulateReply'),id:z.string().uuid(),text:z.string().min(1).max(4000)}),
  z.object({action:z.literal('linkMeta'),id:z.string().uuid(),metaId:z.string().regex(/^\d{5,30}$/)}),
  z.object({action:z.literal('dryRun'),id:z.string().uuid()}),
  z.object({action:z.literal('captureSettings'),enabled:z.boolean(),autoContact:z.boolean()}),
  z.object({action:z.literal('captureNow')}),
  z.object({action:z.literal('followUpSettings'),enabled:z.boolean()}),
  z.object({action:z.literal('verifyCompany'),id:z.string().uuid()})
]);
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || new URL(origin).host !== host || !['localhost','127.0.0.1'].includes(new URL(origin).hostname)) return NextResponse.json({error:'Origem não autorizada.'},{status:403});
  const body = await request.text();
  if (Buffer.byteLength(body,'utf8') > 64000) return NextResponse.json({error:'Dados excedem o limite.'},{status:413});
  try {
    const value = actionSchema.parse(JSON.parse(body));
    switch (value.action) {
      case 'demo': demo(); break;
      case 'pause': pause('Pausado pelo operador.'); break;
      case 'resume':
        if (env.APP_MODE === 'live' && !Object.values(readiness()).every(Boolean)) throw new Error('Configure as integrações antes de iniciar a operação real.');
        setSetting('paused','false'); setSetting('pause_reason',''); event(null,'system_resumed','Operação retomada pelo operador.'); break;
      case 'addLead': addLead(value.lead); break;
      case 'business': saveBusiness(value.business); event(null,'business_updated','Configuração do negócio atualizada pelo operador.'); break;
      case 'stage': setStage(value.id,value.stage); break;
      case 'note':
        if(!getLead(value.id))throw new Error('Lead não encontrado.');
        event(value.id,'operator_note',value.text);
        if(value.nextAction)patchLead(value.id,{nextAction:value.nextAction});
        break;
      case 'contact': requestContact(value.id); break;
      case 'block': optOut(value.id,'Bloqueio registrado pelo operador.'); break;
      case 'simulateReply':
        if (getLead(value.id)?.mode !== 'simulation') throw new Error('Esta ação só está disponível na demonstração.');
        receiveInbound(value.id,`manual-demo:${crypto.randomUUID()}`,value.text); break;
      case 'linkMeta':
        if (getLead(value.id)?.mode !== 'live') throw new Error('Selecione um lead real.');
        patchLead(value.id,{metaId:value.metaId}); event(value.id,'meta_linked','ID da Meta vinculado pelo operador.'); break;
      case 'captureSettings':
        setSetting('capture_enabled',String(value.enabled));setSetting('capture_auto_contact',String(value.autoContact));
        event(null,'capture_settings_updated',`Busca automática ${value.enabled?'ativada':'pausada'}; abordagem automática ${value.autoContact?'ativada':'desativada'}.`);break;
      case 'captureNow':
        if(env.APP_MODE!=='live' || !readiness().openai) throw new Error('Configure OpenAI e modo real antes de captar.');
        setSetting('capture_requested','true');setSetting('capture_enabled','true');break;
      case 'followUpSettings':
        setSetting('follow_up_enabled',String(value.enabled));event(null,'follow_up_settings_updated',`Sequência de três retornos ${value.enabled?'ativada':'pausada'} pelo operador.`);break;
      case 'verifyCompany':await verifyDiscoveredLead(value.id);queueVerifiedProspects();break;
      case 'dryRun': {
        const lead = getLead(value.id);
        if (!lead || lead.mode !== 'live') throw new Error('Selecione um lead real para conferir o navegador.');
        await sendBrowserMessage(lead.handle,'',crypto.randomUUID(),true);
        event(lead.id,'browser_dry_run','Navegador conferido. Nenhuma mensagem digitada ou enviada.'); break;
      }
    }
    return NextResponse.json({ok:true});
  } catch (error) {
    const message = error instanceof z.ZodError ? `Confira os campos: ${error.issues.map(issue => issue.path.join('.')).join(', ')}.` : error instanceof Error ? error.message : 'Não foi possível concluir a ação.';
    return NextResponse.json({error:message.replace(/sk-[A-Za-z0-9_-]+/g,'[segredo oculto]')},{status:400});
  }
}
