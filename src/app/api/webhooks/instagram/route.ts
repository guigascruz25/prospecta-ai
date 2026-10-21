import { NextResponse } from 'next/server';
import { env } from '../../../../lib/config';
import { validSignature, processWebhook } from '../../../../integrations/instagram';
import {existsSync} from 'node:fs';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN && params.get('hub.mode') === 'subscribe' && params.get('hub.verify_token') === env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN) return new Response(params.get('hub.challenge') || '',{status:200});
  return new Response('Verificação não autorizada.',{status:403});
}
export async function POST(request: Request) {
  if(existsSync('updates/maintenance.json'))return new Response('Manutenção temporária. Tente novamente.',{status:503});
  const body = await request.text();
  if (Buffer.byteLength(body,'utf8') > 512000) return new Response('Conteúdo excede o limite.',{status:413});
  if (!validSignature(body,request.headers.get('x-hub-signature-256'))) return new Response('Assinatura inválida.',{status:403});
  if (env.APP_MODE !== 'live') return new Response('Webhook real desativado no modo de simulação.',{status:503});
  try { await processWebhook(JSON.parse(body)); return NextResponse.json({ok:true}); }
  catch { return NextResponse.json({error:'Não foi possível processar o evento. Verifique o CRM e a configuração da Meta.'},{status:503}); }
}
