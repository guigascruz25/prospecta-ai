import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
export function publicAddress(address:string) {
  if(isIP(address)===4) return !/^(0\.|10\.|127\.|169\.254\.|192\.168\.|192\.0\.|198\.(18|19)\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(1[6-9]|2\d|3[01])\.|22[4-9]\.|2[3-5]\d\.)/.test(address);
  if(isIP(address)===6) return !/^(::|fc|fd|fe80|ff)/i.test(address) && !address.includes('ffff:');
  return false;
}
export async function publicWebsiteHtml(input:string,redirects=0):Promise<string> {
  const url=new URL(input);
  if(url.protocol!=='https:' || url.username || url.password || url.port && url.port!=='443' || /(^localhost$|\.local$)/i.test(url.hostname) || redirects>3) throw new Error('Fonte pública inválida.');
  const addresses=await lookup(url.hostname,{all:true});
  if(!addresses.length || addresses.some(item=>!publicAddress(item.address))) throw new Error('Fonte deve apontar para um endereço público.');
  const target=addresses[0];
  const result=await new Promise<{html?:string;redirect?:string}>((resolve,reject)=>{
    const req=request(url,{headers:{'User-Agent':'VendusLocal/0.3 (public business profile verification)'},signal:AbortSignal.timeout(12000),family:target.family,lookup:(_host,_options,callback)=>callback(null,target.address,target.family)},response=>{
      if(response.statusCode && response.statusCode>=300 && response.statusCode<400 && response.headers.location) {response.resume();resolve({redirect:new URL(response.headers.location,url).href});return;}
      if(response.statusCode!==200) {response.resume();reject(new Error('Fonte não disponível.'));return;}
      const chunks:Buffer[]=[];let size=0;
      response.on('data',(chunk:Buffer)=>{chunks.push(chunk);size+=chunk.length;if(size>500000) {resolve({html:Buffer.concat(chunks).toString('utf8')});response.destroy();}});
      response.on('end',()=>resolve({html:Buffer.concat(chunks).toString('utf8')}));
      response.on('error',reject);
    });
    req.on('error',reject);req.end();
  });
  return result.redirect?publicWebsiteHtml(result.redirect,redirects+1):result.html || '';
}
export function instagramLinks(html:string) {
  return [...new Set((html.match(/https:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._]+\/?/g) || []).map(url=>url.replace(/\/$/,'')))];
}
export function websiteAddress(html:string,city:string) {
  const plain=html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ');
  const found=plain.match(/\b(?:Rua|R\.|Av\.|Avenida|Praça|Travessa|Rodovia)\s+.{3,160}/i)?.[0] || '';
  const cityIndex=found.toLowerCase().indexOf(city.toLowerCase());
  return cityIndex>=0?found.slice(0,cityIndex+city.length):found.split(/CNPJ|Siga|Instagram|Copyright|Fale conosco/i)[0].trim();
}
export async function findWebsiteAddress(sourceUrl:string,city:string) {
  const html=await publicWebsiteHtml(sourceUrl);
  let address=websiteAddress(html,city);
  if(address) return {address,sourceUrl};
  const source=new URL(sourceUrl);
  const navigation=[...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(match=>({url:new URL(match[1],source),label:match[2].replace(/<[^>]*>/g,' ')})).filter(link=>link.url.origin===source.origin);
  const pages=[navigation.find(link=>/contato|localiza/i.test(link.label+' '+link.url.pathname)),navigation.find(link=>/sobre|quem-somos|empresa/i.test(link.label+' '+link.url.pathname)),navigation.find(link=>link.url.pathname==='/')].filter(Boolean);
  for(const next of pages.slice(0,2)) if(next && next.url.href!==source.href) {
    try {const page=await publicWebsiteHtml(next.url.href);address=websiteAddress(page,city);if(address) return {address,sourceUrl:next.url.href};} catch {continue;}
  }
  return {address:'',sourceUrl};
}
