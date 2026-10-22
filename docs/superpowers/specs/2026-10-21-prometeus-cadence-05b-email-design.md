# Marco 05B — e-mail, cadências por canal e inbox

Data: 21/10/2026. Estado: **desenho aprovado pelo usuário; plano em elaboração; implementação não iniciada**. Base: `b84e44e`, marco 05A na main. Execução: nativa nesta conversa, conforme escolha anterior do usuário. Pesquisa: [e-mail 05B](../../research/2026-10-21-email-05b-study.md).

## 1. Intenção e sucesso

Uma empresa com workspace vazio conecta sua própria caixa Gmail/Google Workspace por OAuth ou uma caixa por SMTP + IMAP; revisa mensagens e destinatários; publica cadências de e-mail ou mistas com WhatsApp; acompanha mensagens/respostas na inbox. Cada empresa mantém contas, credenciais, destinatários, limites e dados isolados.

Escolha explícita do usuário: Gmail OAuth + SMTP/IMAP. Configurar consoles, credenciais, autorização Google, DNS, callback HTTPS e contas reais **somente no final**, junto com a preparação Meta. Não exigir essas ações para implementar ou executar testes locais. O piloto real permanece uma fase identificada e pendente até ser executado.

Sucesso local: conectores exercitados contra contratos e servidores de teste; autenticação/renovação/falhas simuladas; envio único e recebimento MIME; duas empresas isoladas; cadência mista sem pular etapas; resposta/descadastro interrompem próximos envios; resultados incertos nunca são reenviados automaticamente. Sucesso externo: executar esses caminhos com contas próprias e destinatários autorizados, separadamente por provedor, sem confundir aceite local com integração real validada.

## 2. Alternativas e recomendação

1. **Recomendado: Gmail API e SMTP/IMAP diretos, polling controlado e execução comum no PostgreSQL.** Atende à escolha do usuário, reaproveita a operação 05A e evita nova assinatura/intermediário. Exige lidar com OAuth, MIME, cursores e ambiguidades de envio.
2. Intermediário de caixas unificadas: reduz parte do trabalho de protocolos, acrescentando custo, dependência e processamento de dados por outro serviço. Não é a escolha desta entrega.
3. Somente SMTP: menor escopo, mas não entrega autorização Google, leitura da caixa nem parada confiável por resposta. Não atende ao aceite 05B.

Não haverá envio direto a servidores MX, servidor próprio de e-mail, rotação automática de caixas para contornar quotas ou fallback silencioso entre Gmail/SMTP. Microsoft OAuth, Pub/Sub e rastreio de abertura/cliques ficam fora desta entrega.

## 3. Configuração no produto

Em Configurações › Contas de e-mail, oferecer os dois conectores. Manter hierarquia, componentes, estados vazios e botões explícitos da referência já preservada. Exibir identificação, remetente, disponibilidade de envio/leitura, última sincronização e erro tratável.

**Gmail:** administrador conecta uma caixa mediante autorização Google específica para aquele workspace. O app identifica a caixa pela API autenticada. O login Google da aplicação continua independente; conectar caixa não troca a sessão do usuário nem vincula outra organização. Usar inicialmente apenas o endereço principal autenticado, sem aliases arbitrários.

O servidor possui um cliente OAuth da plataforma para a instalação. Cada empresa autoriza sua própria caixa; não precisa editar variáveis do servidor. As credenciais desse cliente, URI de callback e tela de consentimento serão configuradas pelo responsável da instalação no final. Nenhum cliente global implica caixa global compartilhada.

**SMTP/IMAP:** formulário de host, porta, modo TLS, usuário/segredo de cada protocolo, endereço e nome do remetente, INBOX e pasta de enviados opcional. Envio e leitura são verificados separadamente. `verify()` não comprova entrega nem autorização efetiva do From; o piloto confirmado verifica o envio real. Falta de recebimento funcional bloqueia novas campanhas; histórico continua acessível.

Estados: pendente, autorização necessária, verificando, pronto, atenção/expirado e desconectado; disponibilidades de envio/leitura separadas. Salvar não envia teste. Teste requer destinatário autorizado, prévia e confirmação. Não marcar caixa pronta só porque um segredo foi salvo.

Proprietário/administrador gerencia caixas, limites e publicação. Operador lê inbox e confirma respostas manuais dentro das permissões existentes. Revalidar membro e papel atuais no servidor. Troca de workspace cancela requisições e descarta formulários/rascunhos da organização anterior.

## 4. OAuth, segredos e rede

- Rotas próprias para conexão Gmail, com state aleatório de uso único, validade de dez minutos e vínculo a usuário, sessão, workspace, conexão e revisão; PKCE S256. Callback valida sessão, papel atual e todos os vínculos antes de trocar código e persistir acesso. Destino final interno e fixo, sem redirect arbitrário.
- Solicitar somente identificação necessária, `gmail.send` e `gmail.readonly`; acesso offline para renovação. Não reutilizar tokens de login nem ampliar permissões de uma sessão existente implicitamente.
- Cifrar client secrets quando armazenados, refresh/access tokens e senhas no servidor com a infraestrutura de cifra existente, AAD próprio de provedor/conexão/workspace/revisão. Refresh tem exclusão mútua/CAS; não perder refresh token anterior quando o Google não devolver outro. `invalid_grant` exige reconexão e suspende novos despachos.
- Formulários somente escrita, campo vazio preserva segredo e ação de desconexão explícita. Não retornar segredos, salvar no browser ou registrá-los em logs. Rotação invalida autorizações/revisões antigas para novos envios e preserva tentativas históricas.
- A mesma caixa verificada não pode estar ativa em workspaces diferentes; identificação e reserva ocorrem após verificação remota. Reconexão da mesma caixa mantém identidade interna e cursor compatível; troca de caixa cria outra conexão.
- SMTP externo: 465 com TLS implícito ou 587 com STARTTLS obrigatório. IMAP externo: 993 com TLS implícito. Sem TLS opcional, certificado inválido, URL de transporte com opções livres, comando/proxy/arquivo fornecido pelo cliente ou fallback em texto puro.
- Hosts públicos verificados no momento de cada conexão, incluindo IPv4/IPv6 e mapeamentos; conexão ao IP validado com hostname original para SNI. Bloquear localhost, redes privadas/reservadas/link-local e metadata. Fixtures internas só em harness de teste, sem exceção configurável por workspace.

A autorização de leitura Gmail usa escopo restrito. Documentar verificação OAuth e avaliação de segurança aplicáveis ao lançamento público, expiração no modo de teste e requisitos de uso dos dados. Não solicitar que o usuário resolva esses processos durante implementação local.

## 5. Fronteiras de código e dados

Reaproveitar banco/fila, revisão, auditoria, limites, leases e infraestrutura de cifra; criar módulos próprios de caixa/OAuth, MIME, sincronização e política de e-mail. Tipos discriminados por canal substituem pressupostos universais de telefone/template WhatsApp nos pontos de integração.

Evoluir tabelas e funções por migrações novas; não modificar bytes de migrações aplicadas. Conexões/remetentes passam a distinguir canal/provedor. Dados específicos de caixa, cursor, MIME e thread ficam em estruturas próprias vinculadas por workspace. Conversas de e-mail distinguem threads da mesma pessoa; a unicidade WhatsApp por remetente/identidade continua preservada.

Publicações existentes sem versão explícita mantêm contrato legado 05A. Novas publicações usam contrato versionado com remetente por canal/etapa, destinatário/identidade por canal e conteúdo congelado por lead/etapa. Não reescrever snapshots, tarefas ou recibos históricos. Matrícula representa a sequência do lead e associa suas identidades de canal sem exigir telefone para uma cadência só de e-mail.

O mesmo runtime orquestra a ordem das etapas; políticas/adaptadores são separados. O contrato Gmail nunca utiliza janela de 24h/template Meta, e a autorização de e-mail nunca concede opt-in WhatsApp. Funções de ingresso/despacho recebem os menores privilégios necessários, com RLS, FKs compostas, escopo do workspace antes de LIMIT e testes negativos de acesso.

## 6. Composição, revisão e publicação

E-mail tem assunto, corpo textual, nome/remetente principal, destinatário único e assinatura textual da caixa. Conteúdo final é renderizado e congelado na revisão por destinatário; sem cabeçalhos arbitrários, anexos enviados, CC/BCC ou HTML livre nesta entrega. Uma representação HTML simples gerada e escapada pelo servidor pode acompanhar o texto.

Rejeitar CR/LF em endereços, nomes e assunto, endereços ambíguos e conteúdo fora dos limites. Não remover pontos ou aliases `+` de e-mails para deduplicar. Normalização preserva o local-part e normaliza domínio; não fundir pessoas por heurística Gmail. A revisão mostra exatamente qual endereço receberá cada etapa.

Geração de assunto/corpo usa o fluxo e roteamento 03B/04 existentes: LLM convencional completa sem JEV, JEV somente acompanhado. IA produz rascunhos editáveis; não cria autorização, publica cadência ou dispara sem confirmação. Não exigir nova chamada de IA na publicação ou despacho.

Publicação: escolher caixa e remetente WhatsApp conforme canais usados → selecionar leads elegíveis → revisar cada mensagem, assinatura, atrasos, limites e bloqueios → confirmar. Apenas uma versão ativa por cadência, confirmação idempotente e revisão expira como no 05A. Endereço, corpo, remetente, consentimento ou política alterados invalidam a revisão.

Sequências mistas materializam somente a próxima etapa depois da aceitação da anterior e de seu atraso/calendário. Canal não configurado bloqueia; nunca pular ou trocar de canal para concluir a sequência. Novos leads de uma lista não são matriculados automaticamente sem revisão nesta entrega.

## 7. Política, limites e resultados de envio

Campanhas exigem evidência de autorização para o endereço revisado. E-mail público/qualificado não implica autorização. Aplicar essa regra a ambos os conectores e às caixas Google conectadas por SMTP, sem oferecer troca de protocolo para contorná-la. Resposta manual exige conversa recebida e destinatário correspondente, sem ampliar para envio em massa.

Limites explícitos por caixa e workspace/canal, agregados entre cadências, testes e respostas manuais; nenhum teste fica fora do ledger. Configuração inicial sugerida de 80/dia por caixa pode ser reduzida no piloto, mas não substitui quota do provedor. Intervalo, fuso e dias são revalidados imediatamente antes do envio. Respeitar limites remotos, `Retry-After` e backoff; não anunciar ausência de bloqueio.

Intenção durável e ID de mensagem RFC estável antes do efeito externo; lease/fencing e comparação de revisões como no 05A. Uma aceitação consome uma unidade; incerteza reserva a unidade até resolução. Falha posterior não reembolsa a tentativa aceita.

Gmail send ou SMTP com aceitação final comprovada resulta em **aceito pelo provedor**, sem presumir entrega/leitura. Rejeição temporária comprovada permite no máximo três tentativas totais, respeitando atraso; rejeição permanente bloqueia. Timeout/desconexão após possível submissão ou processo interrompido após intenção produz **incerto**, sem retry cego ou fallback para outra caixa.

Reconciliação busca evidência exata em enviados por Message-ID e conta/remetente/destinatário. Encontrar positivo compatível pode resolver aceitação; ausência em busca não prova rejeição. Resolução humana exige evidência revisada; resultado positivo tardio pode corrigir decisão negativa anterior sem duplicar consumo ou envio. SMTP não depende de APPEND em enviados para declarar a aceitação já comprovada.

Sincronização de entrada deve preceder despachos e ter estado de saúde explícito. Caixa com sincronização vencida há mais de cinco minutos, erro ou recuperação incompleta bloqueia novas campanhas. Como há polling e efeitos externos, resposta que chega depois do último sync ou durante envio pode cruzar com mensagem já em voo; preservar essa limitação no produto e no aceite.

## 8. Sincronização, conversas e interrupção

Polling planejado a cada 60 segundos por caixa, com orçamento global/por conta, backoff e lease exclusivos. A UI mostra última sincronização e opção manual limitada. Nenhum worker é habilitado por padrão.

Na primeira conexão, registrar baseline durável; não importar toda a caixa histórica. Importar mensagens novas de INBOX a partir desse baseline e enviados ligados às operações do app. Explicar essa cobertura no formulário. Desconexão não apaga histórico; reconexão recupera o intervalo desde o último cursor confirmado.

Gmail: `historyId` textual, páginas duráveis e avanço só ao concluir o lote. Cursor expirado inicia recuperação paginada desde o watermark temporal anterior com sobreposição e deduplicação, identificando lacunas em vez de ignorá-las. IMAP: cursor por caixa/UIDVALIDITY/UID, não número de sequência; mudança de UIDVALIDITY exige recuperação controlada. Ações de leitura no app não mudam flags nem excluem mensagens remotas.

Deduplicar por IDs remotos dentro da conta e proveniência, com correlação RFC adicional. Nunca usar apenas assunto para unir threads ou somente Message-ID para deduplicar workspaces. Cabeçalhos `References`/`In-Reply-To` e thread remoto da caixa guiam o vínculo; origem externa fica identificada e vínculos ambíguos exigem revisão.

Resposta recebida e vinculada ao endereço/conversa revisados cancela próximos passos conforme `stopOnReply`; em sequência mista, alcança os passos futuros dos dois canais daquela matrícula. Não associar e-mail e telefone desconhecidos por nome/domínio. Mensagens recebidas em caixas de outro workspace nunca afetam a matrícula.

Classificar resposta humana, aviso automático e DSN usando estrutura MIME/cabeçalhos, não comando de IA. Resposta humana interrompe; classificação ambígua também segura a sequência para revisão. DSN/bounce não conta como resposta humana: correlacionar mensagem/destinatário exatos, suprimir endereço em hard bounce comprovado e bloquear matrícula em soft bounce, sem reenviar automaticamente uma mensagem já aceita. Pausar novas campanhas da caixa em cinco bounces correlacionados no dia local; retomada manual. Auto-respostas reconhecidas não disparam resposta automática do app.

MIME recebido é dado não confiável. Limite inicial: 2 MiB de mensagem bruta, texto armazenado até 64 KiB e até cem metadados de anexos. Processar com limites de tempo/memória e streaming. Excesso gera registro visível e segura sequência correlacionada; não descartar silenciosamente como ausência de resposta. Não armazenar bytes de anexos, executar conteúdo, carregar imagens remotas ou encaminhar instruções recebidas à IA. HTML é convertido em texto para exibição nesta entrega.

## 9. Inbox e descadastro

Inbox com abas E-mail/WhatsApp, filtro por caixa, recebidos/enviados, busca, paginação e não lidos por usuário. Preservar `/messages/whatsapp`; disponibilizar e-mail em `/messages/email` e seleção explícita de canal em `/inbox`. Links antigos e navegação devem ser coerentes. Threads mostram assunto, interlocutores, textos, horário, origem e status reais.

Resposta manual permanece prévia → confirmação → outbox, com threading correto e assinatura revisada. Mensagens vindas diretamente de Gmail/SMTP podem aparecer como externas quando comprovadas pela sincronização, sem inventar autoria do app. Estado lido na interface é do usuário do SaaS, não recibo de leitura do destinatário.

Toda campanha inclui identificação e link de descadastro, apresentado na revisão. Tokens opacos fortes, vinculados ao workspace/endereço/escopo, com hash armazenado. GET mostra confirmação e não altera estado (evitar scanners); POST efetiva de forma idempotente. Endpoint RFC 8058 separado aceita seu POST sem login, com parâmetros esperados e sem revelar dados; limitar abuso. Cabeçalhos one-click dependem do domínio HTTPS configurado e de assinatura DKIM apropriada, cuja verificação real fica no piloto.

Descadastro suprime campanhas para aquele endereço em todas as caixas do workspace e cancela mensagens futuras correspondentes, inclusive passo restante da matrícula mista; não concede/revoga consentimento WhatsApp implicitamente. Pedido textual inequívoco de parar é registrado como supressão; dúvida segura sequência para revisão. Não reativar suprimidos automaticamente por reimportação/IA.

Métricas: aceitos, rejeitados, incertos, respostas, bounces e descadastros. Abertura/cliques e entrega sem evidência devem aparecer como indisponíveis. Não mostrar zero como se fosse medição realizada. Diagnóstico DNS separa TXT observado de autenticação/alinhamento confirmado no e-mail de teste.

## 10. Operação e validação

Desenvolvimento inteiramente local: testes unitários de contratos/política/MIME/threading; integração PostgreSQL isolada de transações, RLS, migrações e concorrência; fixtures HTTP OAuth/Gmail e SMTP/IMAP controlados com falhas antes/depois de aceitação; smoke HTTP autenticado; types/build. Não instalar servidor de e-mail público, iniciar worker externo ou usar caixa pessoal para essas verificações.

Cobrir state/PKCE/replay/troca de workspace, refresh concorrente/revogado, proteção de hosts, CRLF, cross-tenant, cursor paginado/expirado/UIDVALIDITY, MIME excessivo/malicioso, timeout após aceite, dedup/recibo tardio, limites concorrentes, reply/bounce/descadastro, cadência mista e compatibilidade integral 05A. Preservar testes de horário/fração de segundos e janela WhatsApp por remetente.

Piloto final documentado em roteiro conjunto: preparar cliente Google e Gmail API, consentimento e usuário de teste; configurar Meta e HTTPS; informar credenciais diretamente na plataforma; diagnosticar domínio/caixas; revisar um destinatário próprio e conteúdo; executar worker com ID exato e máximo um envio; responder, sincronizar e comprovar interrupção de follow-up. Repetir por Gmail e SMTP/IMAP, sem supor que um valide o outro. Twilio mantém seu aceite real separado. Números/e-mails prospectados não são usados como destinatários de teste.

Cadastro/login Google, conexão Gmail e WhatsApp têm callbacks/permissões distintos. O roteiro final reúne a preparação e explica cada uso, sem tratar uma autorização como substituta das demais. Não publicar o servidor ou escolher domínio/túnel implicitamente.

Documentar setup, limites, operação, reconciliação, cobertura da inbox e evidência local versus externa. Faturamento do SaaS, e-mail transacional público de cadastro/recuperação, Outlook OAuth, LinkedIn, SDR autônomo, anexos completos, migração histórica da caixa, personalização HTML livre, pixels e cliques ficam fora. Mailhog de autenticação permanece isolado dos remetentes comerciais de workspaces.

## 11. Próxima etapa

Revisar esta especificação e aprovar a base antes do plano detalhado. O plano mapeará arquivos/migrações, dependências com versões verificadas, tarefas, testes e compatibilidade. Nenhuma aprovação de credenciais/envio externo é presumida pela aprovação do desenho. A configuração manual continua reservada para o final por instrução explícita do usuário.
