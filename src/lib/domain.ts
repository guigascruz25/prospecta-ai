export const stageLabels: Record<string, string> = {
  discovered: 'Descoberto', qualified: 'Qualificado', contacted: 'Abordado', replied: 'Respondeu',
  interested: 'Interessado', meeting_requested: 'Apresentação solicitada', whatsapp_handoff: 'No WhatsApp', registered: 'Cadastrado',
  active_customer: 'Cliente ativo', joined_affiliate_group: 'Entrou no grupo', active_affiliate: 'Afiliado ativo',
  generated_customer: 'Gerou cliente', closed: 'Encerrado'
};
export const channelLabels: Record<string, string> = {
  browser_contact_pending: 'Contato pendente', waiting_inbound_reply: 'Aguardando resposta',
  api_eligible: 'API disponível', api_active: 'Conversa pela API', api_window_closed: 'Janela expirada',
  human_review_required: 'Revisão necessária', do_not_contact: 'Não contatar', blocked: 'Bloqueado', completed: 'Concluído'
};
export const customerStages = ['discovered','qualified','contacted','replied','interested','meeting_requested','whatsapp_handoff','registered','active_customer','closed'];
export const affiliateStages = ['discovered','qualified','contacted','replied','interested','joined_affiliate_group','active_affiliate','generated_customer','closed'];
export function isOptOut(text: string) {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /\b(pare|parar|stop|remova|remove|cancele|nao me (mande|envie|chame)|nao quero (receber|mensagens)|sair|nao tenho interesse|nao estou interessado)\b/.test(normalized);
}
export function normalizeText(value: string) {return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();}
export function apiWindowOpen(timestamp: string | null, now = Date.now()) {
  if (!timestamp) return false;
  const age = now - Date.parse(timestamp);
  return Number.isFinite(age) && age >= 0 && age < 24 * 60 * 60 * 1000;
}
export function inOperatingHours(now: Date, window: string, timezone: string) {
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  const [start, end] = window.split('-');
  return start <= end ? local >= start && local < end : local >= start || local < end;
}
