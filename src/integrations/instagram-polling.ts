import { z } from 'zod';
import { sqlite } from '../db';
import { env } from '../lib/config';
import { listLeads, patchLead, receiveInbound, setSetting, now, exception } from '../features/crm';
import { graph } from './instagram';
import { cancelFollowUps } from '../features/follow-ups';

const person = z.object({ id: z.string(), username: z.string().optional() });
const conversations = z.object({
  data: z.array(z.object({ id: z.string(), participants: z.object({ data: z.array(person) }) })),
  paging: z.object({ cursors: z.object({ after: z.string().optional() }).optional(), next: z.string().optional() }).optional()
});
const messageList = z.object({ messages: z.object({ data: z.array(z.object({ id: z.string(), created_time: z.string() })) }) });
const messageDetail = z.object({ id: z.string(), created_time: z.string(), from: person, to: z.object({ data: z.array(person) }), message: z.string().max(10000).optional() });
type FetchGraph = (path: string) => Promise<Record<string, unknown>>;

// Official Conversations API. Never follow returned URLs, which may contain access tokens.
export async function pollInstagramInbox(fetchGraph: FetchGraph = graph) {
  const ownerIds = new Set([env.INSTAGRAM_BUSINESS_ACCOUNT_ID, env.INSTAGRAM_SCOPED_ACCOUNT_ID].filter(Boolean));
  const managed = listLeads().filter(lead => lead.mode === 'live' && lead.channel !== 'do_not_contact').map(lead => {
    const contact = sqlite.prepare("SELECT created_at FROM messages WHERE lead_id=? AND direction='outbound' AND channel='browser' AND status IN ('sent','reserved','uncertain') ORDER BY created_at LIMIT 1").get(lead.id) as {created_at:string} | undefined;
    return { lead, cutoff: contact ? Date.parse(contact.created_at) : NaN };
  }).filter(item => Number.isFinite(item.cutoff));
  let received = 0;
  let matched = 0;
  if (managed.length) {
    let cursor = '';
    const remaining = new Set(managed.map(item => item.lead.id));
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ platform: 'instagram', fields: 'id,updated_time,participants', limit: '50' });
      if (cursor) query.set('after', cursor);
      const response = conversations.parse(await fetchGraph(`${env.INSTAGRAM_BUSINESS_ACCOUNT_ID}/conversations?${query}`));
      for (const conversation of response.data) {
        const other = conversation.participants.data.filter(p => !ownerIds.has(p.id));
        // Group conversations and unrelated personal inbox threads are not managed here.
        if (other.length !== 1) continue;
        const participant = other[0];
        const target = managed.find(({lead}) => lead.metaId ? lead.metaId === participant.id : lead.handle === participant.username?.toLowerCase());
        if (!target || !remaining.has(target.lead.id)) continue;
        if (!target.lead.metaId) patchLead(target.lead.id, { metaId: participant.id });
        remaining.delete(target.lead.id);
        matched++;
        const list = messageList.parse(await fetchGraph(`${encodeURIComponent(conversation.id)}?fields=messages.limit(20)`));
        const recent = list.messages.data.filter(m => {
          const time = Date.parse(m.created_time);
          return Number.isFinite(time) && time >= target.cutoff && time <= Date.now() + 60000 && !sqlite.prepare('SELECT id FROM webhook_receipts WHERE id=?').get(m.id);
        }).sort((a,b) => Date.parse(a.created_time)-Date.parse(b.created_time));
        for (const item of recent) {
          const message = messageDetail.parse(await fetchGraph(`${encodeURIComponent(item.id)}?fields=id,created_time,from,to,message`));
          const timestamp = Date.parse(message.created_time);
          if (message.id !== item.id || !Number.isFinite(timestamp) || timestamp < target.cutoff || timestamp > Date.now()+60000) continue;
          if (ownerIds.has(message.from.id) && message.to.data.some(p => p.id === participant.id)) {
            sqlite.prepare('INSERT OR IGNORE INTO webhook_receipts VALUES (?,?)').run(message.id,now());
            const outgoing = sqlite.prepare("SELECT id,created_at FROM messages WHERE lead_id=? AND direction='outbound' AND external_id IS NULL AND text=? ORDER BY created_at DESC LIMIT 1").get(target.lead.id,message.message || '') as {id:string;created_at:string} | undefined;
            if (outgoing && Math.abs(timestamp-Date.parse(outgoing.created_at)) < 120000) sqlite.prepare('UPDATE messages SET external_id=? WHERE id=?').run(message.id,outgoing.id);
            continue;
          }
          if (message.from.id !== participant.id || !message.to.data.some(p => ownerIds.has(p.id))) continue;
          if (!message.message) {
            cancelFollowUps(target.lead.id,'Resposta em áudio ou mídia recebida; sequência interrompida para revisão.');
            sqlite.prepare('INSERT OR IGNORE INTO webhook_receipts VALUES (?,?)').run(message.id,now());
            patchLead(target.lead.id,{channel:'human_review_required',nextAction:'Revisar mensagem sem texto no Instagram'});
            sqlite.prepare("UPDATE jobs SET status='cancelled' WHERE lead_id=? AND kind='reply' AND status='pending'").run(target.lead.id);
            exception(target.lead.id,'Mensagem sem texto recebida. Confira áudio ou mídia no Instagram.');
            continue;
          }
          if (receiveInbound(target.lead.id, message.id, message.message, new Date(timestamp).toISOString())) received++;
        }
      }
      if (!remaining.size || !response.paging?.next || !response.paging.cursors?.after) break;
      cursor = response.paging.cursors.after;
      if (page === 19) throw new Error('Limite de páginas da caixa de entrada atingido. Revise o volume de conversas.');
    }
  }
  setSetting('instagram_last_poll', now());
  setSetting('instagram_poll_error', '');
  return { matched, received };
}
