import {NextResponse} from 'next/server';
import {z} from 'zod';
import {checkRelease,updateView,dispatchUpdate,openGithubLogin} from '../../../../scripts/partner-update-lib.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
function local(request:Request,write=false){try{const url=new URL(request.url);if(!['127.0.0.1','localhost'].includes(url.hostname))return false;const origin=request.headers.get('origin');return !write&&!origin||Boolean(origin&&new URL(origin).host===request.headers.get('host')&&['127.0.0.1','localhost'].includes(new URL(origin).hostname));}catch{return false;}}
const action=z.discriminatedUnion('action',[z.object({action:z.literal('check')}),z.object({action:z.literal('connect')}),z.object({action:z.literal('install'),tag:z.string().regex(/^v\d+\.\d+\.\d+$/)}),z.object({action:z.literal('recover')})]);
let checking:Promise<unknown>|undefined;
export async function GET(request:Request){if(!local(request))return NextResponse.json({error:'Origem não autorizada.'},{status:403});const root=process.cwd();const view=await updateView(root);if(!view.busy){checking??=checkRelease(root).finally(()=>{checking=undefined;});await checking;}return NextResponse.json(await updateView(root),{headers:{'Cache-Control':'no-store'}});}
export async function POST(request:Request){if(!local(request,true))return NextResponse.json({error:'Origem não autorizada.'},{status:403});try{const text=await request.text();if(text.length>1000)throw new Error('Pedido inválido.');const value=action.parse(JSON.parse(text));const root=process.cwd();
  if(value.action==='check'){const view=await updateView(root);if(!view.busy)await checkRelease(root,{force:true});}
  else if(value.action==='connect')await openGithubLogin();
  else await dispatchUpdate(root,value.action,value.action==='install'?value.tag:undefined);
  return NextResponse.json(await updateView(root));
}catch(error){return NextResponse.json({error:error instanceof z.ZodError?'Pedido inválido.':error instanceof Error?error.message:'Não foi possível concluir.'},{status:400});}}
