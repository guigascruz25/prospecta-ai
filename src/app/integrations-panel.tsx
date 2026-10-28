'use client';
import {useState,useEffect,useCallback,type FormEvent} from 'react';
import type {Snapshot} from '../lib/view-model';
import type {IntegrationSection} from '../features/integration-settings';

type Delivery={id:string;kind:string;status:string;http_status:number|null;created_at:string;lead_name:string|null};
type Settings={values:Record<string,string>;configured:Record<string,boolean>;webhookHost:string;appliesWithoutRestart:boolean;deliveries:Delivery[]};
type FieldSpec={key:string;label:string;type?:string;hint?:string;options?:[string,string][]};
const groups:{id:IntegrationSection;title:string;description:string;fields:FieldSpec[]}[]=[
  {id:'openai',title:'OpenAI',description:'Chave, modelos e orçamento para a IA do sistema.',fields:[
    {key:'OPENAI_API_KEY',label:'Chave de API',type:'password'},
    {key:'OPENAI_MODEL',label:'Modelo de pesquisa',hint:'Informe o ID exato habilitado na sua conta.'},
    {key:'OPENAI_MODEL_FAST',label:'Modelo de respostas'},
    {key:'OPENAI_MONTHLY_BUDGET_USD',label:'Orçamento mensal local (US$)',type:'number'},
    {key:'OPENAI_INPUT_USD_PER_MILLION',label:'Preço de entrada / 1 milhão de tokens (US$)',type:'number'},
    {key:'OPENAI_OUTPUT_USD_PER_MILLION',label:'Preço de saída / 1 milhão de tokens (US$)',type:'number'},
    {key:'OPENAI_WEB_SEARCH_USD_PER_CALL',label:'Custo por chamada de busca (US$)',type:'number'}]},
  {id:'instagram',title:'Instagram · API oficial',description:'Insira as credenciais e os IDs do seu aplicativo Meta.',fields:[
    {key:'INSTAGRAM_PAGE_ACCESS_TOKEN',label:'Token de acesso do Instagram',type:'password'},
    {key:'INSTAGRAM_BUSINESS_ACCOUNT_ID',label:'ID da conta Instagram'},
    {key:'INSTAGRAM_SCOPED_ACCOUNT_ID',label:'ID de conta com escopo (opcional)'},
    {key:'INSTAGRAM_GRAPH_VERSION',label:'Versão Graph',hint:'Formato vXX.X, conforme sua integração.'},
    {key:'INSTAGRAM_INBOUND_MODE',label:'Receber respostas por',options:[['polling','Consulta periódica (polling)'],['webhook','Webhook oficial da Meta']]},
    {key:'INSTAGRAM_POLL_INTERVAL_SECONDS',label:'Intervalo de consulta (segundos)',type:'number'},
    {key:'INSTAGRAM_APP_SECRET',label:'App Secret da Meta',type:'password',hint:'Necessário para receber webhook assinado.'},
    {key:'INSTAGRAM_WEBHOOK_VERIFY_TOKEN',label:'Token de verificação do webhook Meta',type:'password'}]},
  {id:'chrome',title:'Chrome dedicado',description:'Endereço local do navegador usado pela operação.',fields:[{key:'CHROME_CDP_URL',label:'Endereço CDP',hint:'Exemplo: http://127.0.0.1:9222. O navegador precisa estar aberto com esse perfil.'}]},
  {id:'webhook',title:'Enviar dados por webhook',description:'Conecte Vendus, n8n, Make ou outro CRM que receba JSON por HTTPS.',fields:[
    {key:'OUTBOUND_WEBHOOK_LABEL',label:'Nome da plataforma'},
    {key:'OUTBOUND_WEBHOOK_URL',label:'URL do webhook de destino',type:'password',hint:'Cole a URL HTTPS fornecida pela plataforma. O endereço salvo não é devolvido ao navegador.'},
    {key:'OUTBOUND_WEBHOOK_HEADER_NAME',label:'Cabeçalho de autenticação (opcional)',hint:'Ex.: Authorization ou X-API-Key. Sem valor, o cabeçalho não é enviado.'},
    {key:'OUTBOUND_WEBHOOK_HEADER_VALUE',label:'Valor do cabeçalho / token (opcional)',type:'password',hint:'Ex.: Bearer SEU_TOKEN. Deixe vazio se o destino não usa autenticação por cabeçalho.'}]}
];
const statuses:Record<string,string>={pending:'Na fila',processing:'Em envio',accepted:'HTTP aceito',rejected:'HTTP rejeitado',unknown:'Não confirmado',cancelled:'Cancelado'};
export function IntegrationsPanel({data,onRefresh}:{data:Snapshot;onRefresh:()=>Promise<void>}){
  const [settings,setSettings]=useState<Settings|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [revision,setRevision]=useState(0),[selected,setSelected]=useState(''),[preview,setPreview]=useState('');
  const load=useCallback(async()=>{const response=await fetch('/api/integrations',{cache:'no-store'});const value=await response.json();if(!response.ok)throw new Error(value.error);setSettings(value);},[]);
  useEffect(()=>{const timer=setTimeout(()=>void load().catch(()=>setError('Não foi possível carregar as configurações de integração.')),0);return()=>clearTimeout(timer);},[load]);
  async function request(payload:Record<string,unknown>){const response=await fetch('/api/integrations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw new Error(result.error);return result;}
  async function save(event:FormEvent<HTMLFormElement>,group:typeof groups[number]){
    event.preventDefault();const form=new FormData(event.currentTarget);setBusy(true);setError('');setNotice('');
    try{
      const values:Record<string,string>={};const clearSecrets:string[]=[];
      for(const field of group.fields){const value=String(form.get(field.key)||'');if(field.type!=='password'||value)values[field.key]=value;if(form.has(`clear:${field.key}`))clearSecrets.push(field.key);}
      if(group.id==='webhook')for(const key of ['OUTBOUND_WEBHOOK_ENABLED','OUTBOUND_WEBHOOK_AUTO_EXPORT','OUTBOUND_WEBHOOK_RESEARCH_ONLY_CONFIRMED'])values[key]=String(form.has(key));
      await request({action:'save',section:group.id,values,clearSecrets});await load();setRevision(value=>value+1);await onRefresh();
      setNotice('Configuração salva. O painel e o worker usam os novos valores sem reiniciar. A fila mantém seu estado atual.');
    }catch(failure){setError(failure instanceof Error?failure.message:'Não foi possível salvar.');}finally{setBusy(false);}
  }
  async function webhookAction(action:'preview'|'test'|'send'){
    setBusy(true);setError('');setNotice('');
    try{
      const result=await request({action,...selected&&action!=='test'?{leadId:selected}:{}});
      if(action==='preview')setPreview(JSON.stringify(result.payload,null,2));
      else {await load();setNotice(result.status==='accepted'?'Destino respondeu com sucesso HTTP. Confira o cadastro na outra plataforma.':result.status==='rejected'?`Destino rejeitou a entrega (HTTP ${result.httpStatus}). Confira a configuração.`:'Entrega não confirmada. Confira o destino antes de repetir; não houve nova tentativa automática.');}
    }catch(failure){setError(failure instanceof Error?failure.message:'Não foi possível concluir.');}finally{setBusy(false);}
  }
  return <><div className="page-heading"><div><p className="eyebrow">CONECTE SUA OPERAÇÃO</p><h1>Integrações</h1><p>Configure as conexões nos campos abaixo. Suas credenciais ficam neste computador.</p></div><button className="button" disabled={busy} onClick={()=>void Promise.all([load(),onRefresh()]).catch(()=>setError('Não foi possível atualizar o diagnóstico.'))}>Atualizar diagnóstico</button></div>
    {error&&<div role="alert" className="alert error">{error}</div>}{notice&&<div role="status" className="alert success">{notice}</div>}
    {!settings?<section className="panel integration-form">Carregando configurações…</section>:<div className="integration-editor-grid">{groups.map(group=><form key={`${group.id}:${revision}`} className={`panel integration-form ${group.id==='webhook'?'webhook-form':''}`} onSubmit={event=>void save(event,group)}><div className="panel-heading"><div><span className="eyebrow">{group.id==='webhook'?'SAÍDA DE DADOS':'CONEXÃO LOCAL'}</span><h2>{group.title}</h2></div><span className={`tag ${group.id==='openai'?data.readiness.openai?'positive':'warning':group.id==='instagram'?data.readiness.meta?'positive':'warning':group.id==='chrome'?data.browserConnected?'positive':'warning':settings.values.OUTBOUND_WEBHOOK_ENABLED==='true'?'positive':'neutral'}`}>{group.id==='webhook'?settings.values.OUTBOUND_WEBHOOK_ENABLED==='true'?'Habilitado':'Desligado':group.id==='openai'?data.readiness.openai?'Configurado':'Pendente':group.id==='instagram'?data.readiness.meta?'Configurado':'Pendente':data.browserConnected?'Conectado':'Sem conexão'}</span></div><p className="integration-description">{group.description}</p><div className="integration-fields">{group.fields.map(field=><label className="field" key={field.key}>{field.label}{field.options?<select name={field.key} defaultValue={settings.values[field.key]}>{field.options.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>:<input name={field.key} type={field.type||'text'} defaultValue={field.type==='password'?'':settings.values[field.key]||''} autoComplete={field.type==='password'?'new-password':'off'} step={field.type==='number'?'any':undefined} min={field.type==='number'?0:undefined} placeholder={field.type==='password'&&settings.configured[field.key]?'Já configurado · deixe vazio para manter':undefined}/>}<small>{field.type==='password'&&settings.configured[field.key]?'Credencial salva. Digite somente para substituir. ':''}{field.hint}</small>{field.type==='password'&&settings.configured[field.key]&&<span className="integration-check"><input type="checkbox" name={`clear:${field.key}`}/> Apagar este valor salvo</span>}</label>)}</div>
      {group.id==='webhook'&&<div className="webhook-options">{settings.webhookHost&&<p>Destino salvo: <strong>{settings.webhookHost}</strong></p>}<label className="integration-check"><input type="checkbox" name="OUTBOUND_WEBHOOK_RESEARCH_ONLY_CONFIRMED" defaultChecked={settings.values.OUTBOUND_WEBHOOK_RESEARCH_ONLY_CONFIRMED==='true'}/> Confirmei que o destino está configurado para receber cadastros/dados, sem iniciar mensagens automaticamente.</label><label className="integration-check"><input type="checkbox" name="OUTBOUND_WEBHOOK_ENABLED" defaultChecked={settings.values.OUTBOUND_WEBHOOK_ENABLED==='true'}/> Habilitar a saída por webhook</label><label className="integration-check"><input type="checkbox" name="OUTBOUND_WEBHOOK_AUTO_EXPORT" defaultChecked={settings.values.OUTBOUND_WEBHOOK_AUTO_EXPORT==='true'}/> Enviar automaticamente as novas empresas encontradas pela captação</label><p>O automático vale para novas captações após ativar e respeita a pausa da fila. Leads antigos são enviados manualmente abaixo. No destino, confira suas automações: os campos do JSON não desligam regras de outra plataforma.</p></div>}
      {group.id==='instagram'&&<p className="integration-help">O webhook de recebimento da Meta é diferente do webhook de saída para o CRM. Endpoint de entrada: <code>/api/webhooks/instagram</code>.</p>}
      <div className="integration-save"><span>Salvar não retoma a prospecção.</span><button disabled={busy} className="button primary" type="submit">{busy?'Aguarde…':`Salvar ${group.id==='webhook'?'webhook':group.title}`}</button></div></form>)}</div>}
    {settings&&<section className="panel webhook-export"><div className="panel-heading"><div><span className="eyebrow">TESTAR E ENVIAR</span><h2>Dados para o seu CRM</h2></div><span className="tag neutral">JSON · POST · HTTPS</span></div><p>Envie empresa, Instagram, cidade, contexto, fontes pesquisadas e próximo passo. Dados ainda desconhecidos ficam vazios.</p><div className="webhook-export-actions"><label className="field">Escolher um lead<select value={selected} onChange={event=>{setSelected(event.target.value);setPreview('');}}><option value="">Dados fictícios para a prévia</option>{data.leads.filter(lead=>lead.mode==='live'&&lead.purpose!=='pilot'&&lead.channel!=='do_not_contact').map(lead=><option key={lead.id} value={lead.id}>{lead.name} · @{lead.handle}</option>)}</select></label><button className="button" disabled={busy} onClick={()=>void webhookAction('preview')}>Ver prévia JSON</button><button className="button" disabled={busy||settings.values.OUTBOUND_WEBHOOK_ENABLED!=='true'} onClick={()=>void webhookAction('test')}>Enviar teste fictício</button><button className="button primary" disabled={busy||!selected||!preview||settings.values.OUTBOUND_WEBHOOK_ENABLED!=='true'} onClick={()=>void webhookAction('send')}>Enviar lead selecionado</button></div>{preview&&<pre className="webhook-preview">{preview}</pre>}<p className="integration-help">O teste envia apenas dados fictícios. O lead selecionado só é enviado pelo botão correspondente, depois da prévia. HTTP aceito confirma o recebimento pelo endpoint; confira o cadastro no CRM. Uma tentativa não confirmada não é repetida automaticamente.</p><div className="webhook-history"><h3>Últimas entregas</h3>{settings.deliveries.length?<ul>{settings.deliveries.map(item=><li key={item.id}><span>{item.kind==='test'?'Teste fictício':item.lead_name||'Lead'}</span><strong>{statuses[item.status]||item.status}{item.http_status?` · ${item.http_status}`:''}</strong><small>{new Date(item.created_at).toLocaleString('pt-BR')}</small></li>)}</ul>:<p>Nenhuma entrega por este painel.</p>}</div></section>}
    <section className="panel integration-form"><h2>Estado da operação</h2><p className="integration-description">{data.paused?'Fila pausada. Salvar integrações mantém a pausa.':'Fila em execução. Alterações valem para as próximas ações; mensagens já iniciadas não são alteradas.'} {data.readiness.liveAllowed?'Modo real habilitado nas configurações locais.':'Envios reais desativados.'}</p><p className="integration-help">As credenciais salvas não são exibidas novamente. Configuração preenchida não substitui a validação de acesso junto ao provedor.</p></section>
  </>;
}
