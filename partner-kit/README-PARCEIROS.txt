PROSPECTA AI — EDIÇÃO PARCEIROS 1.2.2

COMECE AQUI
1. Baixe o ZIP da Release e extraia a pasta Prospecta-AI. Não execute dentro do ZIP.
2. Abra a pasta no Codex local ou Claude com execução local e navegador disponível. Cole PROMPT-MESTRE.txt junto do pacote. O assistente instala, abre as páginas e faz as configurações; você fornece os dados ausentes, digita senhas/códigos nas páginas e aprova os acessos necessários.
3. O assistente lê CONFIGURACAO-ASSISTIDA.txt, verifica as ferramentas reais e conduz a ativação oficial do navegador se faltar. Conectar só o MCP do CRM não concede controle da tela.
4. Ele confere Node.js 24.x com npm e Chrome, executa node scripts/partner-onboarding.mjs e --bootstrap, instala/inicia esta cópia e abre o painel para verificar. Downloads necessários vêm de fontes oficiais; a primeira instalação pode levar alguns minutos. A edição Windows compatível valida o SQLite pré-compilado sem exigir C++.
5. Ele reutiliza ou cria/configura os recursos necessários da SUA conta, incluindo o app Meta quando faltar, e retoma após cada senha/permissão. Verificação de empresa, análise da Meta, termos e custos podem depender do titular/plataforma e não são aprovados pelo instalador.
6. A instalação nova começa em simulação, pausada, sem contas e sem carteira. O assistente configura SUA persona, Instagram e modo de IA escolhido. Nenhum disparo comercial é autorizado pelo instalador. COMECE-AQUI.html também contém as oito microaulas com prompts por etapa.
Alternativa manual: Node.js 24.x oficial → Instalar.cmd → Iniciar.cmd → Diagnosticar.cmd → http://127.0.0.1:3100. Use essa alternativa se preferir operar os comandos. Ela não é necessária quando o assistente dispõe de execução local.

O QUE O DOWNLOAD CONTÉM
Código-fonte, dependências fixadas no lockfile, instalador, bootstrap assistido, diagnóstico, prompt mestre, procedimento de configuração visual, integração MCP, CRM interno, pesquisa automática por API, fila persistente, três follow-ups e material das aulas. O Node, o Chrome, as dependências e as contas de serviços não vêm embutidos. O procedimento é executado pelo agente do parceiro; não é um robô de cadastro Meta embutido no worker.

O QUE NÃO VEM NO DOWNLOAD
Não inclui .env configurado, chaves, tokens, cookies, sessão de Instagram, banco de leads, histórico comercial, backups, logs, screenshots ou pesquisa real do fornecedor. Exemplos de teste são fictícios e ficam separados do CRM.

COMPATIBILIDADE
Instalador e atalhos preparados para Windows 10/11 e Node.js 24.x. Para o assistente fazer tudo, a sessão precisa de acesso local a arquivos/terminal e ferramentas de navegador/computador. Codex desktop e Claude Code/experiências Claude com esses recursos conectados podem conduzir o fluxo. Um chat Claude Desktop que tenha só o MCP do CRM não recebe terminal ou controle de tela por esse motivo. Claude no navegador sem executor local não instala nem executa este aplicativo. macOS/Linux: o código e o MCP são portáveis, mas os atalhos e o fluxo de navegador desta edição têm foco Windows e não foram homologados nesses sistemas.
Codex: conecte o recurso oficial Browser/Computer Use/Chrome conforme o alvo e aprove o perfil necessário. Claude Code: use /chrome ou claude --chrome e conclua a integração oficial do navegador. O assistente conduz esse preparo quando as ferramentas permitem; permissões do cliente ficam com o usuário. Não há promessa de controle de tela em qualquer cliente/assinatura. Confirme abrindo a página e lendo um elemento com a ferramenta real.

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
Os 15 comandos MCP: get_setup_plan, get_status, list_leads, get_lead_timeline, pause_operation, resume_operation, add_lead, queue_first_contact, block_lead, request_capture, configure_capture, get_business, configure_business, configure_follow_ups, record_sales_note. get_setup_plan verifica a instalação local sem expor credenciais; presença de token, navegador instalado e serviço online não comprovam conta validada ou controle de tela.
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
Versão 1.2 ou superior: abra Atualizações, conecte sua própria conta GitHub pelo GitHub CLI oficial e confira a Release disponível. O botão prepara o pacote, faz backup local, pausa, instala e verifica o reinício. Se falhar após a troca, tenta restaurar a versão anterior e o banco. A fila permanece pausada. Leia ATUALIZACOES.txt. Atualizar.cmd oferece recuperação quando o painel não abrir. Instalações 1.1 ou anteriores precisam da primeira migração assistida; não extraia o ZIP por cima de uma instalação em uso.

SUPORTE
Envie versão da Release, versão do Node, etapa e mensagem de erro, com segredos removidos. Diagnosticar.cmd não imprime chaves ou tokens. Não compartilhe .env, .chrome-profile, banco, logs completos nem screenshots de conversas como se fossem arquivos de suporte genéricos.

FONTES CONSULTADAS EM 20/10/2026
Controle Codex: https://learn.chatgpt.com/docs/computer-use
Chrome Codex: https://learn.chatgpt.com/docs/chrome-extension
Chrome Claude Code: https://code.claude.com/docs/en/chrome
Codex MCP: https://developers.openai.com/codex/mcp
Claude Code MCP: https://code.claude.com/docs/en/mcp
Claude Desktop versus Code: https://code.claude.com/docs/en/desktop
Arquitetura MCP: https://modelcontextprotocol.io/docs/learn/architecture
OpenAI Responses: https://developers.openai.com/api/docs/guides/structured-outputs
Pesquisa web OpenAI: https://developers.openai.com/api/docs/guides/tools-web-search
Preços atuais: https://developers.openai.com/api/docs/pricing
Meta: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/
Consulte os fluxos e preços atuais na hora de configurar; disponibilidade depende das contas e permissões do parceiro.
