import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../lib/config';
import { sqlite } from '../db';
import { leads } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { exception, patchLead, receiveInbound, now } from '../features/crm';

export function validSignature(body: string, signature: string | null) {
  if (!env.INSTAGRAM_APP_SECRET || !signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', env.INSTAGRAM_APP_SECRET).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}
const envelope = z.object({ object: z.literal('instagram'), entry: z.array(z.object({ id: z.string(), messaging: z.array(z.object({
  sender: z.object({ id: z.string() }), recipient: z.object({ id: z.string() }), timestamp: z.number(),
  message: z.object({ mid: z.string(), text: z.string().max(10000).optional(), is_echo: z.boolean().optional() }).optional()
})).optional() })) });
export async function graph(path: string, options: RequestInit = {}) {
  if (!/^v\d+\.\d+$/.test(env.INSTAGRAM_GRAPH_VERSION)) throw new Error('Defina a versão da API da Meta no .env.');
  const response = await fetch(`https://graph.instagram.com/${env.INSTAGRAM_GRAPH_VERSION}/${path}`, {
    ...options, headers: { Authorization: `Bearer ${env.INSTAGRAM_PAGE_ACCESS_TOKEN}`, 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`API da Meta retornou HTTP ${response.status}. Confira permissões e janela de atendimento.`);
  return response.json() as Promise<Record<string, unknown>>;
}
export async function processWebhook(body: unknown) {
  const parsed = envelope.parse(body);
  for (const entry of parsed.entry) {
    for (const incoming of entry.messaging || []) {
      if (!incoming.message || incoming.message.is_echo || !incoming.message.text || incoming.recipient.id !== env.INSTAGRAM_BUSINESS_ACCOUNT_ID || entry.id !== env.INSTAGRAM_BUSINESS_ACCOUNT_ID) continue;
      if (sqlite.prepare('SELECT id FROM webhook_receipts WHERE id=?').get(incoming.message.mid)) continue;
      let lead = db.select().from(leads).where(and(eq(leads.metaId,incoming.sender.id),eq(leads.mode,'live'))).get();
      if (!lead) {
        const profile = await graph(`${encodeURIComponent(incoming.sender.id)}?fields=username`);
        if (typeof profile.username === 'string') lead = db.select().from(leads).where(and(eq(leads.handle,profile.username.toLowerCase()),eq(leads.mode,'live'))).get();
        if (lead) patchLead(lead.id, { metaId: incoming.sender.id });
      }
      if (!lead) { exception(null, 'Mensagem recebida de perfil sem correspondência no CRM. Vincule o ID da Meta ao lead.'); continue; }
      const timestamp = new Date(incoming.timestamp);
      if (!Number.isFinite(timestamp.getTime()) || timestamp.getTime() > Date.now() + 60000) throw new Error('Horário de webhook inválido.');
      receiveInbound(lead.id,incoming.message.mid,incoming.message.text,timestamp.toISOString());
    }
  }
  return { processedAt: now() };
}
