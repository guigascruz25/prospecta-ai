import {test} from 'node:test';
import assert from 'node:assert/strict';
import {businessSchema} from '../src/lib/config';
import {openingCopy,followUpCopy,renderCopy} from '../src/lib/outreach';
import {readFileSync} from 'node:fs';
const business=businessSchema.parse({...JSON.parse(readFileSync('config/business.example.json','utf8')),OWNER_NAME:'Ana',COMPANY_NAME:'Empresa Exemplo',PROJECT_NAME:'Solução Exemplo',GEOGRAPHY:'Campinas, SP',VERIFIED_CLAIMS:['Atendimento com agentes de IA.'],OPENING_TEMPLATE:'Oi, {{nome_empresa}}! Falo pela equipe de {{responsavel}}, em {{cidade}}. É com você que trato dos pedidos de orçamento?'});
test('partner templates use the configured persona and preserve pilot separation',()=>{
  assert.equal(openingCopy({name:'Loja Teste',purpose:'prospect'},business),'Oi, Loja Teste! Falo pela equipe de Ana, em Campinas. É com você que trato dos pedidos de orçamento?');
  assert.doesNotMatch(openingCopy({name:'Loja Teste',purpose:'pilot'},business),/Ana|Campinas/);
  assert.doesNotMatch(followUpCopy(3,business),/Guilherme|GRC|Vendus/);
});
test('copy validation rejects unknown variables, invalid cadence and oversized expanded messages',()=>{
  assert.throws(()=>businessSchema.parse({...business,OPENING_TEMPLATE:'Olá {{senha}}'}));
  assert.throws(()=>businessSchema.parse({...business,OPENING_TEMPLATE:'Olá {{cidade'}));
  assert.throws(()=>businessSchema.parse({...business,FOLLOW_UP_TEMPLATES:['Uma mensagem']}));
  assert.throws(()=>renderCopy('Olá {{nome_empresa}}',business,'x'.repeat(601)));
  assert.throws(()=>renderCopy('Olá {{cidade',business));
});
test('three approved follow-ups interpolate the selected company',()=>{
  const configured={...business,FOLLOW_UP_TEMPLATES:['Olá {{nome_empresa}}. É com você?','Posso apresentar {{solucao}}?','Encerro por aqui. Esta abordagem tem apoio de inteligência artificial. Responda se fizer sentido.']};
  assert.match(followUpCopy(1,configured,'Loja Teste'),/Loja Teste/);
  assert.match(followUpCopy(2,configured),/Solução Exemplo/);
});
