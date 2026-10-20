import { normalizeText } from './domain';
export const revenueQuestion='Para confirmar se faz sentido para sua empresa: o faturamento mensal fica acima de R$ 50 mil?';
export function revenueFromAnswer(answer:string,previousOutbound:string,minimum:number) {
  const text=normalizeText(answer);
  const asked=/faturamento mensal.*acima/.test(normalizeText(previousOutbound));
  if(/\b(anual|por ano|ao ano|nao sei|nao sabemos|nao posso informar|varia)\b/.test(text) || /\bentre\b.*\b(e|a)\b/.test(text) || /\b(lucro|salario|funcionarios|investimento|estoque)\b/.test(text)&&!/faturamento|faturamos|fatura|receita mensal/.test(text) || !asked && !/\b(faturamento|faturamos|fatura|receita mensal)\b/.test(text)) return 'unknown';
  const amount=text.match(/r\$\s*(\d[\d.,]*)\s*(mil|k)?\b|\b(\d+(?:[.,]\d+)?)\s*(mil|k)\b/);
  if(amount) {
    const raw=amount[1] || amount[3];
    const unit=amount[2] || amount[4];
    const value=Number(raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw.replace(/\.(?=\d{3}(?:\D|$))/g,''))*(unit?1000:1);
    if(!Number.isFinite(value)) return 'unknown';
    if(value===minimum && /\b(acima|mais de|superior|passa de)\b/.test(text)) return 'qualified';
    return value>minimum?'qualified':'not_qualified';
  }
  if(asked && /^(sim|isso|correto|acima)(?:\b|[.!])/.test(text)) return 'qualified';
  if(asked && /^(nao(?:[.!]|$)|nao,? (fica|faturamos|estamos)|abaixo)/.test(text)) return 'not_qualified';
  return 'unknown';
}
export function meetingFormatFromAnswer(answer:string,previousOutbound:string) {
  const text=normalizeText(answer);
  if(!/apresentacao|online ou presencial|qual formato|dia e horario/.test(normalizeText(previousOutbound)) && !/apresentacao|reuniao|agendar/.test(text)) return '';
  const online=/\b(online|on-line|videochamada|video chamada|remot[ao])\b/.test(text);
  const local=/\b(presencial|pessoalmente|na minha empresa|na nossa empresa)\b/.test(text);
  return online!==local?(online?'online':'presential'):'';
}
export function meetingTimeFromAnswer(answer:string,previousOutbound:string) {
  if(answer.length>300 || !/apresentacao|dia e horario|disponibilidade/.test(normalizeText(previousOutbound))) return '';
  const text=normalizeText(answer);
  return /\b(segunda|terca|quarta|quinta|sexta|sabado|domingo|amanha|hoje|manha|tarde|noite)\b|\b\d{1,2}(?::\d{2}|h(?:\d{2})?)\b|\b\d{1,2}\/\d{1,2}\b/.test(text)?answer.trim():'';
}
