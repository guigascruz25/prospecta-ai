import { randomUUID } from 'node:crypto';
import { sqlite } from '../db';
import { env } from '../lib/config';
import { now, pause } from './crm';

export function reserveBudget(leadId: string | null, model: string, inputTokens: number, outputTokens: number, toolCost = 0) {
  if (!Number.isFinite(toolCost) || toolCost < 0) throw new Error('Custo de ferramentas inválido.');
  const reservation = (inputTokens * env.OPENAI_INPUT_USD_PER_MILLION + outputTokens * env.OPENAI_OUTPUT_USD_PER_MILLION) / 1000000 + toolCost;
  const id = randomUUID();
  const reserved = sqlite.transaction(() => {
    const spent = (sqlite.prepare('SELECT COALESCE(SUM(estimated_cost),0) as value FROM ai_calls WHERE created_at LIKE ?').get(`${now().slice(0,7)}%`) as {value:number}).value;
    if (spent + reservation > env.OPENAI_MONTHLY_BUDGET_USD) return false;
    sqlite.prepare('INSERT INTO ai_calls VALUES (?,?,?,?,?,?,?)').run(id,leadId,model,inputTokens,outputTokens,reservation,now());
    return true;
  })();
  if (!reserved) { pause('Limite mensal de IA atingido ou insuficiente para a próxima chamada.'); throw new Error('Orçamento de IA esgotado.'); }
  return id;
}
