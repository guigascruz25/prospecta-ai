import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readEnvironment} from './partner-update.mjs';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {updateView,checkRelease,dispatchUpdate} from './partner-update-lib.mjs';
const root=process.argv[2]?path.resolve(process.argv[2]):fileURLToPath(new URL('../',import.meta.url));
const initial=await updateView(root);console.log(`Prospecta AI ${initial.currentVersion}`);
if(initial.busy){console.log('Já existe uma atualização em andamento. Aguarde e abra o painel.');process.exit(0);}
if(!initial.recoverable)await checkRelease(root,{force:true});const view=await updateView(root);
const terminal=createInterface({input:stdin,output:stdout});
try{
 if(view.recoverable){console.log('Existe uma atualização interrompida. A recuperação usa somente o backup desta instalação.');if((await terminal.question('Digite RECUPERAR para continuar: ')).trim()==='RECUPERAR')await dispatchUpdate(root,'recover');}
 else if(view.check?.available){console.log(`Versão ${view.check.version} disponível.\n${view.check.notes}`);if((await terminal.question('Digite ATUALIZAR para fazer backup, pausar e atualizar: ')).trim()==='ATUALIZAR')await dispatchUpdate(root,'install',view.check.tag);}
 else console.log(view.check?.error||'Sua versão já está atualizada.');
 console.log(`Painel: http://127.0.0.1:${(await readEnvironment(root)).APP_PORT||3100}/#updates`);
}finally{terminal.close();}
