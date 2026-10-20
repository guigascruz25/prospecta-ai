PROSPECTA AI — EDIÇÃO PARCEIROS 1.0.0

COMECE AQUI
1. Baixe o ZIP da Release e extraia a pasta Prospecta-AI. Não execute dentro do ZIP.
2. Instale Node.js 24.x com npm pelo site oficial https://nodejs.org/ e Google Chrome pelo site oficial https://www.google.com/chrome/ se ainda não tiver.
3. Dê dois cliques em Instalar.cmd. Internet é necessária para baixar dependências do registro npm. A primeira instalação pode levar alguns minutos. O instalador usa os binários fornecidos pelas dependências e valida o SQLite em memória; o fluxo foi preparado para Windows com Node.js 24.x, sem exigir compilação de C++ no caso compatível. Se houver incompatibilidade, procure o suporte em vez de instalar compiladores por tentativa.
4. Abra COMECE-AQUI.html para as oito aulas e prompts. Comece pelo prompt da aula 1 no Codex ou Claude Code com esta pasta aberta.
5. Abra Iniciar.cmd e http://127.0.0.1:3100. Execute Diagnosticar.cmd. A instalação nova começa em simulação, pausada, sem contas e sem carteira.
6. Configure SUA persona, SUA conta Instagram e, para autonomia, SUA API OpenAI. Nenhum envio é liberado pelo instalador.

O QUE O DOWNLOAD CONTÉM
Código-fonte, dependências fixadas no lockfile, instalador, diagnóstico, integração MCP, CRM interno, pesquisa automática por API, fila persistente, três follow-ups e material das aulas. O Node, o Chrome, as dependências e as contas de serviços não vêm embutidos.

O QUE NÃO VEM NO DOWNLOAD
Não inclui .env configurado, chaves, tokens, cookies, sessão de Instagram, banco de leads, histórico comercial, backups, logs, screenshots ou pesquisa real do fornecedor. Exemplos de teste são fictícios e ficam separados do CRM.

COMPATIBILIDADE
Instalador e atalhos preparados para Windows 10/11 e Node.js 24.x. Codex local ou Claude Code com acesso à pasta podem instalar, configurar e operar. O Claude Desktop tradicional pode usar o MCP depois da instalação pelo .cmd; ele não recebe acesso ao terminal ou a arquivos só por conectar este MCP. Claude no navegador sem executor local não instala nem executa este aplicativo. macOS/Linux: o código e o MCP são portáveis, mas os atalhos e o fluxo de navegador desta edição têm foco Windows e não foram homologados nesses sistemas.

COMO CONECTAR O MCP
O instalador gera .codex/config.toml para o projeto Codex e .mcp.json para o Claude Code. Abra a pasta como projeto confiável e reinicie/reconecte os servidores MCP conforme a interface do assistente. Se já existirem arquivos, eles são preservados: os fragmentos atualizados ficam em mcp/.
Para configuração manual, use os caminhos absolutos gerados em mcp/codex.generated.toml ou mcp/claude-desktop.generated.json. No Claude Desktop, abra as configurações de desenvolvedor/MCP e mescle somente a entrada prospecta_ai em mcpServers, preservando os outros servidores. Reinicie o app e consulte get_status. Isso não é publicação em uma loja de plugins.
Mover a pasta depois da instalação: execute node scripts/partner-mcp-config.mjs e atualize/mescle os novos caminhos absolutos nos clientes. Não altere o caminho e suponha que a conexão continuará válida.

IA ASSISTIDA E IA AUTÔNOMA
Assistida: o Claude/Codex usa sua própria inteligência, busca e navegador disponíveis na sessão; MCP conecta essas decisões ao CRM. É possível preparar leads sem configurar OpenAI no aplicativo. A assinatura e os limites do assistente continuam valendo. O MCP não fornece um modelo de IA nem pesquisa web por si só.
Autônoma: o worker desta edição chama OpenAI para decisões estruturadas e pesquisa, e usa o Instagram configurado. Exige chave, modelo, preços, orçamento e permissões válidas. Os gates não liberam o worker comercial real apenas porque o MCP está conectado. request_capture pede busca ao worker e depende dessa API; não chama a busca do Claude/Codex.
Não há adaptação implementada para rodar o worker usando a assinatura do Claude/Codex, nem importação de tokens de login desses produtos. Não extraia credenciais do assistente.

PERSONA E TREINAMENTO
Meu negócio configura a empresa e a solução vendida; o nome da ferramenta continua Prospecta AI. As afirmações comerciais precisam ser verdadeiras e confirmadas pelo parceiro.
OPENING_TEMPLATE e FOLLOW_UP_TEMPLATES podem ser editados pelo formulário ou pelo MCP configure_business. Deixe vazio para usar o padrão. Configure zero ou exatamente três retornos. Variáveis: {{nome_empresa}}, {{responsavel}}, {{empresa}}, {{cidade}}, {{solucao}}. Cada mensagem resultante deve ter até 600 caracteres; variáveis desconhecidas/incompletas e textos maiores são recusados antes do envio.
Os três retornos ficam nominalmente em 24/48/72h, mas horários e limites podem adiar a sequência. Nunca há menos de 24h entre retornos efetivos. Qualquer resposta ou bloqueio cancela novas tentativas. O Instagram pode impedir retornos enquanto a solicitação não for aceita; o sistema não contorna isso.
Aberturas específicas já aprovadas dentro de um job preservam seu texto. Revise a fila antes de mudar uma campanha. Isto é configuração de mensagens e regras; não é treinamento/fine-tuning do modelo.

PESQUISA E CRM
Pesquise fontes públicas, registre contexto e indique lacunas. Não estime faturamento por avaliações ou seguidores. O CRM interno exige um @ de Instagram; empresas só com telefone ficam no arquivo de pesquisa ou no CRM externo, sem inventar perfil.
Os 14 comandos MCP: get_status, list_leads, get_lead_timeline, pause_operation, resume_operation, add_lead, queue_first_contact, block_lead, request_capture, configure_capture, get_business, configure_business, configure_follow_ups, record_sales_note.
O CRM interno funciona sem Vendus. O exportador opcional é descrito em INTEGRACAO-VENDUS.txt. Ele não faz sincronização bidirecional e não transfere o controle das conversas automaticamente.

LIGAÇÕES E REUNIÕES
Aula 8 prepara uma ligação feita pelo parceiro, com briefing, roteiro e registro pelo MCP. Telefonia/voz autônoma não está implementada. Preferências de reunião são registradas como pendentes: o sistema não consulta disponibilidade de calendário nem confirma agendamento por conta própria.

ABRIR, PAUSAR E ENCERRAR
Iniciar.cmd abre servidor e worker em segundo plano, apenas em localhost. O computador deve ficar ligado e conectado. O Chrome dedicado precisa continuar disponível quando houver tarefas de navegador. O chat do assistente não precisa ficar aberto para o worker com API executar sua fila.
Parar.cmd primeiro pausa a fila; se houver tarefa em execução, pede para aguardar e tentar novamente. Ele confere que o processo pertence a esta pasta antes de encerrá-lo. Não mata todos os processos Node ou Chrome.
Não foi instalado serviço do Windows, tarefa de inicialização automática, painel em nuvem ou acesso remoto. O sistema é local, sem login multiusuário. Não publique a porta 3100 na Internet como se fosse um SaaS autenticado.
Se a porta estiver ocupada, não feche outro aplicativo: escolha outra APP_PORT no .env, gere os arquivos MCP novamente e use a nova URL.

ATUALIZAÇÕES E BACKUPS
Guarde seu .env, config/business.json, banco e perfil Chrome em local privado. Backups SQLite ficam em backups/; não contêm credenciais nem perfil do navegador.
Para atualizar: pause, espere as tarefas terminarem, faça backup, pare esta instalação, extraia a próxima versão em OUTRA pasta e consulte as notas da Release antes de migrar os seus próprios dados. Não substitua uma pasta configurada pelo ZIP. Não copie banco ou perfil de outro parceiro. Preserve a lista de não contato e só retome depois de conferir o estado da fila.

SUPORTE
Envie versão da Release, versão do Node, etapa e mensagem de erro, com segredos removidos. Diagnosticar.cmd não imprime chaves ou tokens. Não compartilhe .env, .chrome-profile, banco, logs completos nem screenshots de conversas como se fossem arquivos de suporte genéricos.

FONTES CONSULTADAS EM 20/10/2026
Codex MCP: https://developers.openai.com/codex/mcp
Claude Code MCP: https://code.claude.com/docs/en/mcp
Claude Desktop versus Code: https://code.claude.com/docs/en/desktop
Arquitetura MCP: https://modelcontextprotocol.io/docs/learn/architecture
OpenAI Responses: https://developers.openai.com/api/docs/guides/structured-outputs
Pesquisa web OpenAI: https://developers.openai.com/api/docs/guides/tools-web-search
Preços atuais: https://developers.openai.com/api/docs/pricing
Meta: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/
Consulte os fluxos e preços atuais na hora de configurar; disponibilidade depende das contas e permissões do parceiro.
