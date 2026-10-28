import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {publicAddress} from './public-website';
import {validateWebhookUrl} from '../features/integration-settings';

export async function postPublicWebhook(endpoint:string,body:string,headers:Record<string,string>):Promise<{status:number}> {
  const url=validateWebhookUrl(endpoint);
  const addresses=await lookup(url.hostname.replace(/^\[|\]$/g,''),{all:true});
  if(!addresses.length||addresses.some(item=>!publicAddress(item.address)))throw new Error('O webhook deve apontar para um servidor público.');
  const target=addresses[0];
  return new Promise((resolve,reject)=>{
    const req=request(url,{method:'POST',headers:{...headers,'Content-Type':'application/json','Content-Length':String(Buffer.byteLength(body))},signal:AbortSignal.timeout(15000),family:target.family,lookup:(_host,_options,callback)=>callback(null,target.address,target.family)},response=>{
      response.resume();
      // Never follow redirects or retain response bodies that could contain credentials.
      resolve({status:response.statusCode||0});
    });
    req.on('error',()=>reject(new Error('Entrega não confirmada. Confira o destino antes de tentar novamente.')));
    req.end(body);
  });
}
