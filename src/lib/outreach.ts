import type { Business } from './config';
import type { Lead } from '../db/schema';
import { PLATFORM_NAME } from './brand';

type CopyBusiness=Pick<Business,'OWNER_NAME'|'COMPANY_NAME'|'GEOGRAPHY'|'PROJECT_NAME'>;
export function previewCopy(render:()=>string){try{return render();}catch{return 'Revise o texto e as variáveis em Meu negócio: a mensagem final deve ter até 600 caracteres.';}}
export function renderCopy(template:string,business:Partial<CopyBusiness>,companyName='') {
  const values:Record<string,string>={nome_empresa:companyName,responsavel:business.OWNER_NAME||`a equipe da ${business.COMPANY_NAME||'empresa'}`,empresa:business.COMPANY_NAME||'',cidade:business.GEOGRAPHY?.split(',')[0]||'',solucao:business.PROJECT_NAME||'solução'};
  const rendered=template.replace(/\{\{([^}]+)\}\}/g,(_,key:string)=>{if(!(key in values))throw new Error('Variável de mensagem desconhecida.');return values[key].replace(/[\r\n]+/g,' ').trim();});
  if(rendered.includes('{{')||rendered.includes('}}')||!rendered.trim()||rendered.length>600)throw new Error('Revise a mensagem: variável incompleta ou texto acima de 600 caracteres.');
  return rendered.trim();
}

export function openingCopy(lead:Pick<Lead,'purpose'|'name'>,business:Pick<Business,'OWNER_NAME'|'COMPANY_NAME'|'GEOGRAPHY'>&Partial<Pick<Business,'OPENING_TEMPLATE'|'PROJECT_NAME'>>) {
  if(lead.purpose==='pilot') return 'Teste de conexão do Prospecta AI. Pode responder esta mensagem?';
  if(business.OPENING_TEMPLATE) return renderCopy(business.OPENING_TEMPLATE,business,lead.name);
  const identity=business.OWNER_NAME ? `o ${business.OWNER_NAME}` : `a equipe da ${business.COMPANY_NAME}`;
  const company=lead.name.trim().replace(/[\r\n]+/g,' ').slice(0,80);
  return `Oi, tudo bem? Aqui é ${identity}, de ${business.GEOGRAPHY.split(',')[0]}. Queria falar com o proprietário ou com quem cuida das vendas${company?` da ${company}`:''}, sobre o atendimento dos pedidos que chegam pelo WhatsApp. É com você que eu falo?`;
}

export const conversationLabels:Record<string,string>={contact:'Chegar ao responsável',diagnosis:'Entender a rotina de atendimento',offer:'Avaliar interesse na solução',qualification:'Confirmar porte da operação',invitation:'Escolher formato da apresentação',time:'Combinar preferência de horário',complete:'Confirmar apresentação com o responsável'};

export function followUpCopy(step:number,business:Pick<Business,'PROJECT_NAME'|'VERIFIED_CLAIMS'>&Partial<Pick<Business,'OWNER_NAME'|'COMPANY_NAME'|'GEOGRAPHY'|'FOLLOW_UP_TEMPLATES'>>,companyName='') {
  if(!Number.isInteger(step)||step<1||step>3)throw new Error('Follow-up fora da sequência de três tentativas.');
  if(business.FOLLOW_UP_TEMPLATES?.length===3) return renderCopy(business.FOLLOW_UP_TEMPLATES[step-1],business,companyName);
  if(step===1) return 'Oi! Retomando minha mensagem: queria entender como vocês atendem os pedidos que chegam pelo WhatsApp fora do expediente. É você quem cuida dessa parte ou pode me indicar o responsável?';
  if(step===2) {
    const claim=business.VERIFIED_CLAIMS.find(value=>value.includes('24 horas')) || business.VERIFIED_CLAIMS[0];
    if(!claim) throw new Error('Configure uma afirmação comprovada antes do follow-up.');
    return `Pra te dar um pouco mais de contexto: ${claim} A ideia é avaliar se esse apoio faz sentido para a rotina de vocês. Vale te mostrar como funciona numa apresentação rápida?`;
  }
  if(step===3) return `Vou encerrar minhas tentativas de contato por aqui. Esta prospecção foi feita 100% com inteligência artificial, usando o ${PLATFORM_NAME} e uma abordagem configurada por ${business.OWNER_NAME || 'nossa equipe'}. Se fizer sentido conhecer ${business.PROJECT_NAME || 'nossa solução'}, responda esta mensagem e seguimos com uma apresentação. Obrigado pelo seu tempo!`;
  throw new Error('Follow-up fora da sequência de três tentativas.');
}

export const followUpLabels:Record<string,string>={not_scheduled:'Sem sequência agendada',scheduled:'Próximo retorno agendado',finished:'Três retornos concluídos; sem novas tentativas',cancelled:'Retornos interrompidos por resposta ou encerramento',platform_blocked:'Instagram aguarda aceitação da solicitação; retornos impedidos'};
