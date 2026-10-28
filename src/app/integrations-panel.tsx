'use client';
import {useState,useEffect,useCallback,type FormEvent} from 'react';
import type {Snapshot} from '../lib/view-model';
import type {IntegrationSection} from '../features/integration-settings';
import {openaiModelOptions,recommendedOpenAIModel,modelOption,suggestedModelRates} from '../lib/openai-model-options';

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
function Chevron(){return <svg className="integration-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>;}
function IntegrationIcon({id}:{id:IntegrationSection}){
  return <span className={`integration-icon icon-${id}`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{id==='openai'?<><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/><path d="m20 3 .5 1.5L22 5l-1.5.5L20 7l-.5-1.5L18 5l1.5-.5Z"/></>:id==='instagram'?<><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/></>:id==='chrome'?<><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M2 9h20M6 6.5h.01M9 6.5h.01"/><path d="m10 12-3 3 3 3m4-6 3 3-3 3"/></>:<><path d="m9 14 6-4M9 10l6 4"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="18" cy="18" r="3"/></>}</svg></span>;
}
function IntegrationField({field,settings}:{field:FieldSpec;settings:Settings}){
  const saved=field.type==='password'&&settings.configured[field.key];
  return <div className="field integration-field"><label htmlFor={field.key}>{field.label}</label>{field.options?<select id={field.key} name={field.key} defaultValue={settings.values[field.key]}>{field.options.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>:<input id={field.key} name={field.key} type={field.type||'text'} defaultValue={field.type==='password'?'':settings.values[field.key]||''} autoComplete={field.type==='password'?'new-password':'off'} step={field.type==='number'?'any':undefined} min={field.type==='number'?0:undefined} placeholder={saved?'Já configurado · deixe vazio para manter':undefined} aria-describedby={field.hint||saved?`${field.key}-hint`:undefined}/>}{(field.hint||saved)&&<small id={`${field.key}-hint`}>{saved?'Credencial salva. Preencha apenas para substituir. ':''}{field.hint}</small>}{saved&&<details className="integration-secret-options"><summary>Gerenciar valor salvo</summary><label className="integration-check"><input type="checkbox" name={`clear:${field.key}`}/> Apagar este valor ao salvar</label></details>}</div>;
}
function OpenAIFields({settings,fields}:{settings:Settings;fields:FieldSpec[]}){
  const initialResearch=settings.values.OPENAI_MODEL||recommendedOpenAIModel.id;
  const initialReplies=settings.values.OPENAI_MODEL_FAST||recommendedOpenAIModel.id;
  const [models,setModels]=useState({research:initialResearch,replies:initialReplies});
  const [custom,setCustom]=useState({research:!modelOption(initialResearch),replies:!modelOption(initialReplies)});
  const existingModels=Boolean(settings.values.OPENAI_MODEL||settings.values.OPENAI_MODEL_FAST);
  const [prices,setPrices]=useState({input:existingModels?settings.values.OPENAI_INPUT_USD_PER_MILLION||'0':String(recommendedOpenAIModel.input),output:existingModels?settings.values.OPENAI_OUTPUT_USD_PER_MILLION||'0':String(recommendedOpenAIModel.output)});
  const [suggestion,setSuggestion]=useState(false);
  function choose(which:'research'|'replies',value:string){
    setCustom(previous=>({...previous,[which]:value==='custom'}));
    if(value==='custom')return;
    const next={...models,[which]:value};setModels(next);
    const rates=suggestedModelRates(next.research,next.replies);
    if(rates)setPrices({input:String(rates.input),output:String(rates.output)});
    setSuggestion(false);
  }
  function recommend(){
    setModels({research:recommendedOpenAIModel.id,replies:recommendedOpenAIModel.id});
    setCustom({research:false,replies:false});
    setPrices({input:String(recommendedOpenAIModel.input),output:String(recommendedOpenAIModel.output)});
    setSuggestion(true);
  }
  return <>
    <div className="integration-model-suggestion"><span className="suggestion-spark" aria-hidden="true">✦</span><div><strong>Uma configuração simples para começar</strong><p>GPT-6 Luna para pesquisar e responder, com os preços de referência preenchidos.</p></div><button className="button" type="button" onClick={recommend}>Usar recomendação</button></div>
    {suggestion&&<p className="integration-inline-notice" role="status">Sugestão preenchida. Clique em Salvar OpenAI para aplicar.</p>}
    <div className="integration-fields">
      <IntegrationField field={fields[0]} settings={settings}/>
      <IntegrationField field={fields[3]} settings={settings}/>
      {(['research','replies'] as const).map(which=>{
        const key=which==='research'?'OPENAI_MODEL':'OPENAI_MODEL_FAST';
        const label=which==='research'?'Modelo de pesquisa':'Modelo de respostas';
        const selected=modelOption(models[which]);
        return <div className="field integration-field" key={which}><label htmlFor={`${key}-select`}>{label}</label><select id={`${key}-select`} name={custom[which]?undefined:key} value={custom[which]?'custom':selected?.id||models[which]} onChange={event=>choose(which,event.target.value)}>{openaiModelOptions.map(model=><option key={model.id} value={model.id}>{model.label}{model.id===recommendedOpenAIModel.id?' · recomendado':''}</option>)}<option value="custom">Outro modelo / manter ID atual</option></select>{custom[which]?<input aria-label={`ID personalizado · ${label.toLowerCase()}`} name={key} value={models[which]} onChange={event=>setModels(previous=>({...previous,[which]:event.target.value}))} placeholder="ID exato do modelo na API"/>:<small>{selected?.description}</small>}</div>;
      })}
    </div>
    <p className="integration-help">Modelos atuais são preservados até você salvar. O acesso depende da sua conta OpenAI. <a href="https://developers.openai.com/api/docs/models/gpt-6-luna" target="_blank" rel="noreferrer">Ver modelo recomendado ↗</a></p>
    <details className="integration-advanced"><summary><span>Ajustes avançados de custos<small>Preços de referência e busca na web</small></span><Chevron/></summary><div className="integration-fields">{fields.slice(4,6).map((field,index)=><div className="field integration-field" key={field.key}><label htmlFor={field.key}>{field.label}</label><input id={field.key} name={field.key} type="number" min="0" step="any" value={index===0?prices.input:prices.output} onChange={event=>setPrices(previous=>({...previous,[index===0?'input':'output']:event.target.value}))}/></div>)}<IntegrationField field={fields[6]} settings={settings}/></div><p className="integration-help">A estimativa local usa um par de preços para os dois modelos. Ao escolher duas sugestões diferentes, usamos a maior tarifa de cada tipo. Para IDs personalizados, confira os valores. Referência: 28/10/2026; a cobrança real depende do uso e da tabela do provedor.</p></details>
  </>;
}
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
  function connectionStatus(id:IntegrationSection){
    if(id==='openai')return {label:data.readiness.openai?'Configurado':'Pendente',tone:data.readiness.openai?'positive':'warning'};
    if(id==='instagram')return {label:data.readiness.meta?'Configurado':'Pendente',tone:data.readiness.meta?'positive':'warning'};
    if(id==='chrome')return {label:data.browserConnected?'Conectado':'Sem conexão',tone:data.browserConnected?'positive':'neutral'};
    return {label:settings?.values.OUTBOUND_WEBHOOK_ENABLED==='true'?'Habilitado':'Desligado',tone:settings?.values.OUTBOUND_WEBHOOK_ENABLED==='true'?'positive':'neutral'};
  }
  const webhookTools=settings&&<div className="webhook-tools">
    <details className="integration-advanced"><summary><span>Testar e enviar dados<small>Prévia do JSON, teste fictício e envio de um lead</small></span><Chevron/></summary><div className="webhook-export">
      <p>Envie empresa, Instagram, cidade, contexto, fontes pesquisadas e próximo passo.</p>
      <div className="webhook-export-actions"><label className="field">Escolher um lead<select value={selected} onChange={event=>{setSelected(event.target.value);setPreview('');}}><option value="">Dados fictícios para a prévia</option>{data.leads.filter(lead=>lead.mode==='live'&&lead.purpose!=='pilot'&&lead.channel!=='do_not_contact').map(lead=><option key={lead.id} value={lead.id}>{lead.name} · @{lead.handle}</option>)}</select></label><button className="button" disabled={busy} onClick={()=>void webhookAction('preview')}>Ver prévia JSON</button><button className="button" disabled={busy||settings.values.OUTBOUND_WEBHOOK_ENABLED!=='true'} onClick={()=>void webhookAction('test')}>Enviar teste fictício</button><button className="button primary" disabled={busy||!selected||!preview||settings.values.OUTBOUND_WEBHOOK_ENABLED!=='true'} onClick={()=>void webhookAction('send')}>Enviar lead selecionado</button></div>
      {preview&&<pre className="webhook-preview">{preview}</pre>}
      <p className="integration-help">O teste envia somente dados fictícios. O lead é enviado após a prévia, pelo botão correspondente. HTTP aceito confirma recebimento pelo endpoint; confira o cadastro no CRM. Entregas incertas não são repetidas automaticamente.</p>
    </div></details>
    <details className="integration-advanced"><summary><span>Histórico de entregas<small>{settings.deliveries.length?`${settings.deliveries.length} entregas recentes`:'Nenhuma entrega por este painel'}</small></span><Chevron/></summary><div className="webhook-history">{settings.deliveries.length?<ul>{settings.deliveries.map(item=><li key={item.id}><span>{item.kind==='test'?'Teste fictício':item.lead_name||'Lead'}</span><strong>{statuses[item.status]||item.status}{item.http_status?` · ${item.http_status}`:''}</strong><small>{new Date(item.created_at).toLocaleString('pt-BR')}</small></li>)}</ul>:<p>Nenhuma entrega por este painel.</p>}</div></details>
  </div>;
  return <>
    <div className="page-heading"><div><p className="eyebrow">CONECTE SUA OPERAÇÃO</p><h1>Integrações</h1><p>Suas conexões, em um só lugar. Clique para configurar.</p></div><button className="button" disabled={busy} onClick={()=>void Promise.all([load(),onRefresh()]).catch(()=>setError('Não foi possível atualizar o diagnóstico.'))}>Atualizar diagnóstico</button></div>
    {error&&<div role="alert" className="alert error">{error}</div>}{notice&&<div role="status" className="alert success">{notice}</div>}
    <div className="integrations-intro"><span className="integrations-intro-dot"/><p>Configure no seu ritmo.<span> As credenciais ficam salvas neste computador.</span></p><span className="integration-private">CONEXÕES DA SUA OPERAÇÃO</span></div>
    {!settings?<section className="panel integration-form">Carregando configurações…</section>:<div className="integration-editor-grid">{groups.map(group=>{
      const status=connectionStatus(group.id);
      const advanced=group.id==='instagram'?group.fields.filter(field=>!['INSTAGRAM_PAGE_ACCESS_TOKEN','INSTAGRAM_BUSINESS_ACCOUNT_ID'].includes(field.key)):group.id==='webhook'?group.fields.slice(2):[];
      const basic=group.id==='instagram'?group.fields.slice(0,2):group.id==='webhook'?group.fields.slice(0,2):group.fields;
      return <details key={group.id} className={`panel integration-card integration-card-${group.id}`} name="integration-connection">
        <summary className="integration-card-summary"><IntegrationIcon id={group.id}/><div className="integration-card-title"><h2>{group.id==='instagram'?'Instagram':group.id==='webhook'?'Webhook e CRM':group.title}</h2><p>{group.id==='openai'?'Inteligência, modelos e orçamento':group.id==='instagram'?'Mensagens pela API oficial da Meta':group.id==='chrome'?'Seu navegador de prospecção':'Leads no Vendus e em outras plataformas'}</p></div><div className="integration-card-trailing"><span className={`tag ${status.tone}`}>{status.label}</span><span className="integration-configure">Configurar</span></div><Chevron/></summary>
        <div className="integration-card-body">
          <form key={`${group.id}:${revision}`} className="integration-form" onSubmit={event=>void save(event,group)}>
            <p className="integration-description">{group.description}</p>
            {group.id==='openai'?<OpenAIFields settings={settings} fields={group.fields}/>:<>
              <div className="integration-fields">{basic.map(field=><IntegrationField key={field.key} field={field} settings={settings}/>)}</div>
              {!!advanced.length&&<details className="integration-advanced"><summary><span>{group.id==='instagram'?'Configuração avançada da Meta':'Autenticação do webhook'}<small>{group.id==='instagram'?'Recebimento, versão da API e credenciais adicionais':'Opcional · cabeçalho e token de acesso'}</small></span><Chevron/></summary><div className="integration-fields">{advanced.map(field=><IntegrationField key={field.key} field={field} settings={settings}/>)}</div>{group.id==='instagram'&&<p className="integration-help">Webhook de entrada da Meta: <code>/api/webhooks/instagram</code>. Essa conexão é diferente da saída de dados para o CRM.</p>}</details>}
            </>}
            {group.id==='webhook'&&<div className="webhook-options">
              {settings.webhookHost&&<p>Destino salvo: <strong>{settings.webhookHost}</strong></p>}
              <label className="integration-check"><input type="checkbox" name="OUTBOUND_WEBHOOK_RESEARCH_ONLY_CONFIRMED" defaultChecked={settings.values.OUTBOUND_WEBHOOK_RESEARCH_ONLY_CONFIRMED==='true'}/><span>Destino preparado para receber dados<small>Confirme que o CRM não iniciará mensagens automaticamente ao receber cadastros.</small></span></label>
              <label className="integration-check"><input type="checkbox" name="OUTBOUND_WEBHOOK_ENABLED" defaultChecked={settings.values.OUTBOUND_WEBHOOK_ENABLED==='true'}/><span>Habilitar saída por webhook<small>Permite testes e envio de leads para a plataforma configurada.</small></span></label>
              <label className="integration-check"><input type="checkbox" name="OUTBOUND_WEBHOOK_AUTO_EXPORT" defaultChecked={settings.values.OUTBOUND_WEBHOOK_AUTO_EXPORT==='true'}/><span>Enviar novas captações automaticamente<small>Vale para novos leads após ativar e respeita a pausa da fila.</small></span></label>
              <p>Leads antigos são enviados individualmente em “Testar e enviar dados”. Confira também as automações da plataforma de destino.</p>
            </div>}
            <div className="integration-save"><span>Alterações só são aplicadas ao salvar.</span><button disabled={busy} className="button primary" type="submit">{busy?'Salvando…':`Salvar ${group.id==='webhook'?'webhook':group.title}`}</button></div>
          </form>
          {group.id==='webhook'&&webhookTools}
        </div>
      </details>;
    })}</div>}
    <div className="integration-operation-note"><span className={`integration-state-dot ${data.paused?'is-paused':''}`}/><p><strong>{data.paused?'Prospecção pausada':'Prospecção em execução'}</strong><span>Salvar uma conexão mantém o estado da fila. Configuração preenchida não confirma acesso ao provedor.</span></p></div>
  </>;
}
