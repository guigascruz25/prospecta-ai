import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export async function generateMcpFiles(root) {
  const server={command:process.execPath,args:[path.join(root,'scripts','mcp.mjs')]};
  const claude={mcpServers:{prospecta_ai:server}};
  const toml=`[mcp_servers.prospecta_ai]\ncommand = ${JSON.stringify(server.command)}\nargs = [${JSON.stringify(server.args[0])}]\nstartup_timeout_sec = 20\ntool_timeout_sec = 60\n`;
  for(const dir of ['mcp','.codex'])await mkdir(path.join(root,dir),{recursive:true});
  await writeFile(path.join(root,'mcp','codex.generated.toml'),toml);
  await writeFile(path.join(root,'mcp','claude-desktop.generated.json'),JSON.stringify(claude,null,2));
  for(const [relative,content] of [['.codex/config.toml',toml],['.mcp.json',JSON.stringify(claude,null,2)]]) {
    const target=path.join(root,relative);
    try{await readFile(target);console.log(`Configuração existente preservada: ${relative}. Use o fragmento em mcp/ se precisar mesclar.`);}catch(error){if(error.code!=='ENOENT')throw error;await writeFile(target,content,{flag:'wx'});}
  }
  console.log('MCP: configuração local do Codex e Claude Code preparada; fragmento do Claude Desktop em mcp/.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await generateMcpFiles(fileURLToPath(new URL('../',import.meta.url)));
