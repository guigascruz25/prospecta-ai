import { chromium, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { env, getBusiness } from '../lib/config';
import { normalizeText } from '../lib/domain';

export function profileEvidence(body: string, city: string) {
  const text=normalizeText(body);
  const local=text.includes(normalizeText(city));
  const business=/\b(loja|clinica|imobiliaria|concessionaria|moveis|academia|oficina|estetica|odontologia|supermercado|restaurante|materiais|roupas|construcao|atacado|varejo|farmacia|laboratorio|pet shop|autopecas|auto pecas|guincho|socorro|mecanica|automotivo|automotivos|empresa)\b/.test(text);
  return {local,business,verified:local&&business};
}
async function assertBrowserOwner(page: Page) {
  const owner=getBusiness().INSTAGRAM_HANDLE.replace(/^@/,'').toLowerCase();
  const profileLink=page.getByRole('link',{name:`Foto do perfil de ${owner}`,exact:true}).or(page.getByRole('link',{name:`Profile picture of ${owner}`,exact:true}));
  await profileLink.first().waitFor({state:'visible',timeout:15000});
  const href=await profileLink.first().getAttribute('href');
  if(!href || new URL(href,'https://www.instagram.com').pathname!==`/${owner}/`) throw new Error('A conta do Chrome não corresponde ao Instagram configurado.');
  return owner;
}
export async function inspectBusinessProfile(handle: string, city: string) {
  if(!/^[a-z0-9._]{1,30}$/.test(handle)) throw new Error('Perfil inválido.');
  const endpoint=new URL(env.CHROME_CDP_URL);
  if(!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)) throw new Error('CDP deve estar em localhost.');
  const browser=await chromium.connectOverCDP(env.CHROME_CDP_URL,{timeout:10000});
  let page:Page|undefined;
  try {
    page=await browser.contexts()[0].newPage();
    await page.route('**/*',route=>route.request().isNavigationRequest()&&new URL(route.request().url()).hostname!=='www.instagram.com'?route.abort():route.continue());
    await page.goto(`https://www.instagram.com/${handle}/`,{waitUntil:'domcontentloaded'});
    await assertBrowserOwner(page);
    await page.getByRole('heading',{name:handle,exact:true}).first().waitFor({state:'visible',timeout:15000});
    const body=await page.locator('body').innerText();
    if(/action blocked|try again later|ação bloqueada|tente novamente mais tarde|suspended|suspensa/i.test(body)) throw new Error('Restrição do Instagram detectada.');
    const evidence=profileEvidence(body,city);
    const address=body.match(/\b(?:Rua|Avenida|Av\.|Praça|Travessa|Rodovia)\s+[^\n]{3,160}/i)?.[0] || '';
    return {...evidence,address,note:evidence.verified?'Cidade e atividade comercial encontradas no perfil público.':'Localização ou atividade comercial não confirmada no perfil; revisão necessária.'};
  } finally {await page?.close();await browser.close();}
}

export async function browserStatus() {
  try {
    const url = new URL(env.CHROME_CDP_URL);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return false;
    const response = await fetch(new URL('/json/version', url), { signal: AbortSignal.timeout(2500) });
    return response.ok && Boolean((await response.json()).webSocketDebuggerUrl);
  } catch { return false; }
}
export class MessageRequestPendingError extends Error {}
export class MessageComposerUnavailableError extends Error {}
export function instagramThreadUrl(href:string) {
  try {const url=new URL(href,'https://www.instagram.com');return url.protocol==='https:'&&url.hostname==='www.instagram.com'&&!url.username&&!url.password&&!url.port&&/^\/direct\/t\/\d+\/?$/.test(url.pathname)?`https://www.instagram.com${url.pathname}`:null;} catch {return null;}
}
export function pendingMessageRequest(body:string) {
  const text=normalizeText(body);
  return /(?:convite enviado|invitation sent|invite sent|(?:nao pode|nao e possivel|can't|cannot) enviar (?:mais |outra |novas )?mensage|so pode enviar uma mensagem|you can only send one message|accepts? (?:your|the) (?:message|chat)|aceit(?:e|ar|a) (?:o|seu) (?:convite|solicitacao)|can send more messages (?:once|after))/.test(text);
}
export async function sendBrowserMessage(handle: string, message: string, jobId: string, dryRun = true, beforeSend: () => void | Promise<void> = () => {}, followUp=false) {
  const endpoint = new URL(env.CHROME_CDP_URL);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) throw new Error('CDP deve estar em localhost.');
  if (!dryRun && (env.APP_MODE !== 'live' || env.ALLOW_LIVE_SENDS !== 'true')) throw new Error('Envio real não autorizado na configuração.');
  const browser = await chromium.connectOverCDP(env.CHROME_CDP_URL, { timeout: 10000 });
  let page: Page | undefined;
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error('Contexto do Chrome indisponível.');
    page = await context.newPage();
    await page.route('**/*', route => {
      const request = route.request();
      if (request.isNavigationRequest() && new URL(request.url()).hostname !== 'www.instagram.com') return route.abort();
      return route.continue();
    });
    await page.goto(`https://www.instagram.com/${encodeURIComponent(handle)}/`, { waitUntil: 'domcontentloaded' });
    if (page.url().includes('/accounts/login')) throw new Error('Sessão do Instagram ausente.');
    const owner = await assertBrowserOwner(page);
    const body = await page.locator('body').innerText();
    if (/action blocked|try again later|ação bloqueada|tente novamente mais tarde|suspended|suspensa/i.test(body)) throw new Error('Restrição do Instagram detectada.');
    const messageButton = page.getByRole('button', { name: /^(message|mensagem|enviar mensagem)$/i }).or(page.getByRole('link', { name: /^(message|mensagem|enviar mensagem)$/i }));
    await messageButton.first().click({ timeout: 10000 });
    if(followUp && pendingMessageRequest(await page.locator('body').innerText())) throw new MessageRequestPendingError('Instagram aguarda aceitação da solicitação de mensagem.');
    const editor = page.getByRole('textbox').last();
    try {await editor.waitFor({ state: 'visible', timeout: 45000 });}
    catch {if(followUp) throw new MessageRequestPendingError('Instagram não disponibiliza o campo de mensagem para este retorno.');throw new MessageComposerUnavailableError('Campo de mensagem não abriu para este perfil; nenhuma mensagem foi digitada ou enviada.');}
    if(followUp && !await editor.isEditable()) throw new MessageRequestPendingError('Instagram não permite editar outra mensagem nesta conversa.');
    if (dryRun) return { dryRun: true, url: page.url(), username: owner };
    const link=page.locator('a[href*="/direct/t/"]').first();
    const persistedThread=instagramThreadUrl(page.url()) || (await link.count()?instagramThreadUrl(await link.getAttribute('href') || ''):null);
    await editor.pressSequentially(message, { delay: 75 });
    await page.waitForTimeout(1000);
    await beforeSend();
    const send=page.getByRole('button',{name:/^(Enviar|Send)$/i});
    if(await send.last().isVisible()) await send.last().click();
    else await editor.press('Enter');
    await page.waitForFunction(element=>Boolean(element && (element instanceof HTMLTextAreaElement?element.value.trim()==='':element.textContent?.trim()==='')),await editor.elementHandle(),{timeout:10000});
    await page.getByText(message, { exact: true }).last().waitFor({ state: 'visible', timeout: 10000 });
    await page.getByText(/^(Enviando|Sending)(\.{3}|…)?$/i).first().waitFor({state:'hidden',timeout:30000});
    // Optimistic bubbles or a filled editor are not proof of delivery. Reopen the observed
    // thread and require the message in the server-loaded history before closing our tab.
    if(persistedThread) await page.goto(persistedThread,{waitUntil:'domcontentloaded'});
    else {await page.reload({waitUntil:'domcontentloaded'});await messageButton.first().click({timeout:15000});}
    await assertBrowserOwner(page);
    await page.getByText(message,{exact:true}).last().waitFor({state:'visible',timeout:45000});
    return { dryRun: false, url: page.url() };
  } catch (error) {
    mkdirSync('screenshots', { recursive: true });
    if (page) {
      await page.screenshot({ path: `screenshots/${jobId}.png` }).catch(() => {});
      const snapshot = await page.locator('body').ariaSnapshot().catch(() => 'Snapshot indisponível');
      writeFileSync(`screenshots/${jobId}.txt`, `${page.url()}\n${snapshot}`, { mode: 0o600 });
    }
    throw error;
  } finally {
    await page?.close();
    await browser.close();
  }
}
