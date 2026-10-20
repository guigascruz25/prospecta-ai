import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const lines=(await readFile(path.join(root,'SHA256SUMS.txt'),'utf8')).trim().split(/\r?\n/);let checked=0;
for(const line of lines){const match=line.match(/^([a-f0-9]{64})  (.+)$/);if(!match)throw new Error('Manifesto inválido.');const name=match[2];const target=path.resolve(root,name);const relative=path.relative(root,target);if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Caminho fora da pasta do pacote.');const hash=createHash('sha256').update(await readFile(target)).digest('hex');if(hash!==match[1])throw new Error(`Arquivo diferente do pacote publicado: ${name}`);checked++;}
console.log(`Integridade conferida: ${checked} arquivos. Checksums detectam alterações; confira também a origem da Release.`);
