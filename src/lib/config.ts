import { config as loadEnv } from 'dotenv';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname,join,basename } from 'node:path';
import { z } from 'zod';

loadEnv({ quiet: true });
const text = z.string().max(3000);
const copyTemplate = z.string().max(600).refine(value=>{
  const matches=[...value.matchAll(/\{\{([^{}]+)\}\}/g)];
  const remainder=value.replace(/\{\{[^{}]+\}\}/g,'');
  return !remainder.includes('{{')&&!remainder.includes('}}')&&matches.every(match=>['nome_empresa','responsavel','empresa','cidade','solucao'].includes(match[1]));
}, 'Use apenas variáveis completas de mensagem documentadas.');
export const businessSchema = z.object({
  OWNER_NAME: text, OWNER_ROLE: text, COMPANY_NAME: text,
  PROJECT_NAME: text.default(''), COMPANY_WEBSITE: text,
  OPENING_TEMPLATE: copyTemplate.default(''), FOLLOW_UP_TEMPLATES: z.array(copyTemplate.min(1)).refine(values=>values.length===0||values.length===3,'Configure os três retornos ou deixe a lista vazia.').default([]),
  INSTAGRAM_HANDLE: z.string().regex(/^@?[a-zA-Z0-9._]*$/),
  WHATSAPP_LINK: z.string().refine(value => !value || /^https:\/\/wa\.me\/\d+$/.test(value), 'Use https://wa.me/55DDDNUMERO'),
  AFFILIATE_GROUP_LINK: z.string().refine(value => !value || /^https:\/\/chat\.whatsapp\.com\/[a-zA-Z0-9]+$/.test(value), 'Use o link oficial do grupo'),
  ONE_LINE_PITCH: text, HOW_IT_WORKS: z.array(text), REVENUE_MODEL: text,
  MARKET_JARGON: text, VERIFIED_CLAIMS: z.array(z.string().trim().min(1).max(3000)), UNVERIFIED_CLAIMS: z.array(z.string().trim().min(1).max(3000)),
  ICP_SEGMENTS: z.array(text), ICP_KEYWORDS: z.array(text), AFFILIATE_TOPICS: z.array(text),
  GEOGRAPHY: text, MIN_MONTHLY_REVENUE: z.number().nonnegative().default(0),
  MEETING_DURATION_MINUTES: z.number().int().min(10).max(120).default(20),
  MEETING_FORMATS: z.array(z.enum(['online','presential'])).min(1).default(['online','presential'])
});
export type Business = z.infer<typeof businessSchema>;
export function getBusiness(): Business {
  return businessSchema.parse(JSON.parse(readFileSync(join(process.cwd(),'config',basename(process.env.BUSINESS_CONFIG_PATH || 'business.json')), 'utf8')));
}
export function saveBusiness(value: unknown) {
  const validated = businessSchema.parse(value);
  const target=join(process.cwd(),'config',basename(process.env.BUSINESS_CONFIG_PATH || 'business.json'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(`${target}.tmp`, JSON.stringify(validated, null, 2), { mode: 0o600 });
  renameSync(`${target}.tmp`, target);
  return validated;
}
const envSchema = z.object({
  DATABASE_URL: z.string().default('data/app.db'),
  APP_MODE: z.enum(['simulation', 'live']).default('simulation'),
  ALLOW_LIVE_SENDS: z.enum(['true', 'false']).default('false'),
  OPENAI_API_KEY: z.string().default(''), OPENAI_MODEL: z.string().default(''), OPENAI_MODEL_FAST: z.string().default(''),
  OPENAI_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(20),
  OPENAI_INPUT_USD_PER_MILLION: z.coerce.number().nonnegative().default(0),
  OPENAI_OUTPUT_USD_PER_MILLION: z.coerce.number().nonnegative().default(0),
  CHROME_CDP_URL: z.string().default('http://127.0.0.1:9222'),
  INSTAGRAM_APP_SECRET: z.string().default(''), INSTAGRAM_PAGE_ACCESS_TOKEN: z.string().default(''),
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN: z.string().default(''), INSTAGRAM_BUSINESS_ACCOUNT_ID: z.string().default(''),
  INSTAGRAM_GRAPH_VERSION: z.string().default(''),
  INSTAGRAM_SCOPED_ACCOUNT_ID: z.string().default(''),
  INSTAGRAM_INBOUND_MODE: z.enum(['webhook', 'polling']).default('webhook'),
  INSTAGRAM_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(30).max(600).default(60),
  MAX_DMS_PER_DAY: z.coerce.number().int().min(1).max(100).default(30),
  INITIAL_DMS_PER_DAY: z.coerce.number().int().min(1).max(100).default(5),
  MIN_SECONDS_BETWEEN_DMS: z.coerce.number().int().min(90).default(90),
  MAX_SECONDS_BETWEEN_DMS: z.coerce.number().int().min(90).default(240),
  OPERATING_HOURS: z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/).default('09:00-20:00'),
  OPERATING_TIMEZONE: z.string().default('America/Sao_Paulo'),
  CAPTURE_ENABLED: z.enum(['true','false']).default('false'),
  CAPTURE_AUTO_CONTACT: z.enum(['true','false']).default('false'),
  CAPTURE_INTERVAL_HOURS: z.coerce.number().min(1).max(168).default(6),
  CAPTURE_BATCH_SIZE: z.coerce.number().int().min(1).max(15).default(8),
  CAPTURE_MAX_NEW_LEADS_PER_DAY: z.coerce.number().int().min(1).max(100).default(20),
  OPENAI_WEB_SEARCH_USD_PER_CALL: z.coerce.number().positive().default(0.01)
});
export const env = envSchema.parse(process.env);
if (env.MAX_SECONDS_BETWEEN_DMS < env.MIN_SECONDS_BETWEEN_DMS) throw new Error('Intervalo máximo inferior ao mínimo.');
new Intl.DateTimeFormat('pt-BR', { timeZone: env.OPERATING_TIMEZONE });
export function readiness() {
  const business = getBusiness();
  return {
    business: Boolean(business.COMPANY_NAME && business.INSTAGRAM_HANDLE && business.ONE_LINE_PITCH && business.VERIFIED_CLAIMS.length && business.WHATSAPP_LINK),
    openai: Boolean(env.OPENAI_API_KEY && env.OPENAI_MODEL && env.OPENAI_MODEL_FAST && env.OPENAI_INPUT_USD_PER_MILLION > 0 && env.OPENAI_OUTPUT_USD_PER_MILLION > 0),
    meta: Boolean(env.INSTAGRAM_PAGE_ACCESS_TOKEN && env.INSTAGRAM_BUSINESS_ACCOUNT_ID && /^v\d+\.\d+$/.test(env.INSTAGRAM_GRAPH_VERSION) && (env.INSTAGRAM_INBOUND_MODE === 'polling' || (env.INSTAGRAM_APP_SECRET && env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN))),
    liveAllowed: env.APP_MODE === 'live' && env.ALLOW_LIVE_SENDS === 'true'
  };
}
