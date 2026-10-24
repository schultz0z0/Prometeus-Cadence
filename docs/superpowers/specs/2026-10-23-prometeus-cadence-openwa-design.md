# WhatsApp próprio com OpenWA — desenho

Data: 23/10/2026. Estado: proposta para revisão. Execução nativa nesta conversa, conforme preferência já recebida.

Revisão de construibilidade por leitor independente concluída nesta conversa, sem questões importantes em aberto. A aprovação do desenho pelo usuário permanece pendente.

## Intenção e decisão do usuário

Substituir Twilio por **WhatsApp próprio — OpenWA**, com QR Code dentro do Prometeus, mantendo **WhatsApp Oficial — Meta** como alternativa. O usuário escolheu OpenWA gerenciado no Docker. Nenhum próximo marco será iniciado até concluir esta mudança. A autorização inclui obter o código upstream e ligá-lo à inbox, cadências e serviços contínuos.

O usuário pediu informação clara de risco de bloqueio e sugestão de volume. Não pediu promessa de proteção contra banimento. A conexão Meta de teste será desconectada somente após a implementação e a preparação do pareamento OpenWA; histórico e evidências Meta serão preservados.

## Abordagens

1. **Gateway gerenciado + QR no app — escolhido pelo usuário.** Prometeus administra sessões, credenciais e callbacks no backend. Exige capacidade de Chromium e operação do gateway, mas elimina a configuração de outro serviço pelo cliente.
2. **Gateway externo por URL/chave.** Mais flexível para clientes técnicos, porém transfere instalação e diagnóstico ao cliente. Não faz parte desta entrega.
3. **Incorporar um cliente WhatsApp diretamente ao processo Next.** Não aproveita a separação e os contratos já existentes do gateway escolhido, e liga o ciclo de vida de Chromium ao servidor web. Descartado.

## Base examinada

Ver [estudo do OpenWA](../../research/2026-10-23-openwa-study.md). Referência upstream: `rmyndharis/OpenWA`, revisão `173916c83b41e622f849ecd380bf36486dfd8cdf`, versão declarada `0.25.0`, licença MIT. Reaproveitar o projeto, sem recriar seu motor WhatsApp.

## Experiência da empresa

- Dois cards: **WhatsApp Oficial — Meta** e **WhatsApp próprio — OpenWA**. Hierarquia e fluxo inspirados na captura CadenceFlow; identidade visual e componentes atuais do Prometeus.
- Meta mantém credenciais, verificação, templates e operação existentes. Evitar texto que garanta imunidade a bloqueio para qualquer provedor.
- OpenWA oferece **Conectar por QR Code**. Administrador informa apenas nome da conexão; o backend cria e vincula a sessão.
- Antes de parear, aviso: conexão não oficial, risco de desconexão/restrição/banimento, recomendação de número dedicado e envio a pessoas que esperam o contato. Sem cobrança por mensagem do gateway; infraestrutura continua consumindo recursos.
- QR temporário na tela autenticada, com atualização limitada enquanto a sessão aguarda pareamento. Nenhuma chave de gateway, cookie ou arquivo de sessão chega ao navegador.
- Estados claros: preparando, aguardando QR, autenticando, conectado, desconectado, ação necessária e erro. QR indisponível não é sucesso. Reinício autenticado não exige novo QR se a sessão for recuperável.
- Exibir número conectado, último estado, reconectar/desconectar e limites. Não abrir o dashboard administrativo upstream para usuários finais.
- Ações administrativas mantêm os papéis existentes. Troca de workspace fecha QR/formulários e impede aplicar respostas tardias a outra empresa.

## Infraestrutura — decisões propostas do implementador

- Integrar o upstream em `third_party/openwa` como dependência Git fixada, com documentação de checkout recursivo, atualização e licença. Não copiar seu histórico Git para o repositório principal nem misturar seus arquivos aos módulos do Prometeus. A cópia de estudo atual permanece ignorada.
- Imagem construída a partir dessa revisão e lockfile, em serviço Compose próprio. Motor inicial **`whatsapp-web.js`**; sem seleção de Baileys pelo cliente nesta entrega.
- Usar inicialmente `WWEBJS_WEB_VERSION=off`, opção documentada pelo gateway para carregar o cliente servido pelo WhatsApp, em vez de buscar HTML de um registro de versões de terceiros sem verificação de integridade. Compatibilidade deve ser comprovada no piloto, sem alegar que isso impede banimento.
- API do gateway limitada ao loopback do host/rede Docker. Chave administrativa de provisionamento somente no backend; chave operacional limitada às sessões da conexão, cifrada com o mecanismo existente. Serviços do gateway sem Docker socket, plugins, MCP ou administração de infraestrutura desnecessária.
- Volume próprio para autenticação, configuração e banco interno do gateway. Inicialmente uma instância com SQLite próprio, suporte upstream a PostgreSQL documentado para operação posterior. PostgreSQL do Prometeus continua sendo autoridade de workspace, conexões, mensagens, provas, fila e uso. Nenhum banco ou volume de outros projetos será modificado.
- Receiver leve na rede Docker recebe apenas callbacks OpenWA e usa o papel restrito de ingresso existente para persistir eventos. Não publica porta do host, login ou painel. Isso evita exigir um túnel público para conectar um gateway que já roda na nossa infraestrutura.
- OpenWA envia para o hostname interno desse receiver. Permitir apenas esse hostname em `SSRF_ALLOWED_HOSTS`, mantendo proteção SSRF ligada.
- `restart: unless-stopped`, healthcheck e persistência para gateway/receiver. Os serviços contínuos existentes do Prometeus conservam suas funções, limites e execução oculta no Windows.
- Padrões operacionais: sessão autenticada pode recuperar conexão; ausência de sessão exige ação do usuário. Sem envio automático decorrente de inicialização/pareamento. Sem atualizar dependências upstream automaticamente.

## Fronteira de empresa e sessão

- Modelo guarda `workspace_id`, conexão e UUID de sessão remoto. Unicidade impede que uma sessão seja adotada por duas conexões/empresas.
- Todas as rotas recebem a conexão local; a sessão remota é resolvida pelo servidor dentro do workspace, nunca escolhida por um UUID arbitrário do navegador.
- Provisionamento usa chave administrativa; operações usuais usam chave limitada a `allowedSessions`. O isolamento não depende de nomes de sessão ou do frontend.
- Segredo HMAC aleatório por conexão, cifrado e vinculado à revisão. Cada webhook é restrito à sessão dessa conexão. Validar assinatura e vínculo antes de normalizar/persistir.
- QR e respostas de conexão com `Cache-Control: no-store`; dados transitórios só em memória da tela. Sem token ou QR em logs, screenshots de validação, armazenamento local, commits ou mensagens de erro.
- Identidade e histórico são escopados à conexão/provedor. Não unir automaticamente conversa Meta a OpenWA só porque os números parecem iguais.
- Apenas conversas individuais de texto entram no piloto. Grupos, canais, status e mensagens de sistema não viram leads nem alimentam cadências. Identificadores LID opacos não são convertidos em telefone por adivinhação.
- Novas mensagens após a conexão são sincronizadas. Importação retroativa de todo o WhatsApp e envio/visualização de anexos ficam fora desta entrega; mídia recebida é identificada como no piloto atual.

## Contratos OpenWA e confiabilidade

- Pin e registrar os contratos reais de criar/iniciar/consultar sessão, QR, logout, registrar webhook, enviar texto e consultar mensagem. Fonte é o código/contrato da revisão fixada, com exemplos de fixtures saneadas.
- Consumir `message.received`, `message.sent`, `message.ack` e `session.status`. QR é consultado sob demanda autenticada; não armazenar o evento QR bruto como histórico de negócio.
- HMAC-SHA256 em `X-OpenWA-Signature` sobre corpo bruto; comparar em tempo constante. Limitar corpo, validar esquema, `sessionId`, evento e identificadores. Descartar duplicata pela identidade do evento e da mensagem; não confiar somente em headers de deduplicação.
- Datas de mensagem upstream em segundos e datas de envelope em ISO são tratadas separadamente. Eventos fora de ordem não regridem entrega/leitura.
- Envio usa a outbox atual, com `Idempotency-Key` estável, vinculado à tentativa e ao corpo. HTTP de sucesso indica aceitação pelo gateway, não entrega ao telefone. Somente ACK inequívoco avança estados de entrega/leitura.
- Preservar distinção entre falha comprovada e resultado incerto. Timeout não autoriza repetição com nova chave. A janela upstream de 24 horas de idempotência não autoriza reenvio depois que ela expira.
- Vincular o `messageId` retornado ao identificador dos eventos/consultas conforme o contrato observado, incluindo callbacks que cheguem antes da resposta HTTP. Ecos do envio não criam uma mensagem de entrada duplicada.
- Webhooks alimentam a inbox e interrompem follow-ups conforme as regras atuais. Reconciliação limitada consulta estado/ACK do gateway sem enviar mensagem. Persistir cursor/identidade de processamento e impedir duplicatas em recuperação.
- Poll de sessão limitado, com backoff e cancelamento; nenhum loop sem limite ou geração contínua de novos QR. O desenho detalhado de frequência, lotes e endpoints pertence ao plano, com critérios verificáveis.

## Cadências, políticas e limites

- `openwa` é provedor do canal WHATSAPP; mantém revisão humana, isolamento, supressão/descadastro, pausa, cotas, evidência de autorização e parada ao receber resposta.
- Políticas são por capacidade do provedor. A regra de texto livre em janela de 24 horas e templates aprovados permanece na Meta; não é imposta artificialmente ao OpenWA. Isso não retira a exigência de autorização e os demais controles de envio.
- No OpenWA, esta entrega suporta texto de resposta e etapas de cadência com variáveis renderizadas. Templates oficiais Meta não são convertidos nem enviados silenciosamente por OpenWA.
- Proposta de início: **20 mensagens automatizadas/dia por remetente**, **até 5 novas conversas/dia com destinatários autorizados**, espaçamento atual de **60–180 segundos**. São escolhas conservadoras do produto, não limites certificados pelo WhatsApp e não garantia contra bloqueio.
- Valores por remetente/workspace, editáveis explicitamente por administrador e revalidados atomicamente no envio. A cota geral existente continua compartilhada com os demais canais; não será aumentada ao conectar OpenWA.
- Habilitar pacing do gateway com teto inicial constante, sem a escalada automática upstream. O teto efetivo nunca excede o limite revisado no Prometeus; documentar a interação entre os dois controles.
- O teto de infraestrutura é configurado pelo operador e limita o intervalo permitido na edição do workspace; o piloto começa com teto de 20/dia, exibido como tal. Não aceitar na UI um número maior que o gateway aplicará nem afirmar que salvá-lo aumentou a capacidade. Uma elevação desse teto requer configuração explícita da plataforma e recarga dos processos afetados.
- Erros consecutivos e restrição de conta pausam novos envios, mostram motivo e exigem diagnóstico. Sem rotação de números, proxies para contornar restrições ou alternância silenciosa entre provedores.
- Mensagens pessoais enviadas fora do Prometeus não representam permissão para cadência; explicar que a sugestão se refere à automação pelo sistema, sem prometer controlar todo o uso do telefone.

## Retirada do Twilio e transição Meta

- Remover card, formulário de cadastro e escolha de Twilio em novas configurações. Novas verificações, sincronizações e transmissões Twilio deixam de estar disponíveis.
- Preservar os valores legados necessários para ler histórico, recibos, referências de prova e backups. Não reescrever registros Twilio como OpenWA. Pausar/bloquear eventuais publicações Twilio, sem migrar silenciosamente destinatários ou conteúdo.
- Retirar dependência executável e caminhos ativos Twilio na medida em que não sejam necessários para o histórico. Testes de legado devem demonstrar leitura preservada e impossibilidade de novo envio.
- Atualizar migrações, validações, provedor, crypto/AAD, capabilities, ingestão, despacho, conteúdo, UI e documentação. Manter smoke/regressão Meta e e-mail.
- Nenhuma publicação Meta existente passa a usar OpenWA automaticamente. Um novo remetente exige seleção e nova revisão da publicação.
- No aceite desta entrega, desconectar apenas a conexão Meta de teste do workspace indicado pelo usuário; preservar sua inbox e evidências. A opção de reconectar Meta permanece no produto. Pareamento real exige o usuário ler o QR no próprio telefone.

## Critérios de aceite

1. Serviço OpenWA fixado inicia no Docker e recupera seu volume após reinício; nenhum console fica abrindo no Windows.
2. Proprietário conecta pelo QR dentro do Prometeus. Outra empresa/operador sem permissão não acessa QR, chave, sessão ou histórico alheios.
3. QR expirado, desconexão e ação necessária são estados úteis, sem falso conectado.
4. Envio individual revisado e recebimento real com número próprio autorizado funcionam; aceitação e ACK são distintos. Sem chamar resultado incerto de entregue.
5. Inbox permanece atualizada; resposta do contato interrompe follow-up; deduplicação resiste a repetição de webhook e reinício.
6. Cadência de texto OpenWA publica com revisão, cumpre limites/horários/supressão e não usa templates Meta. Um teste integrado local cobre isso antes de qualquer piloto real.
7. Limites e novo-contato/dia são persistidos e aplicados na UI, backend e dispatcher; nenhuma elevação automática de volume.
8. Twilio não pode ser conectado nem disparar; histórico existente continua legível. Meta e e-mail passam suas regressões.
9. Meta de teste é desconectada somente no final. Homologação real usa destinatários próprios; leitura do QR e confirmação de testes ficam com o usuário.

## Fora do escopo e pendências externas

Instância externa por cliente, escolha dinâmica de motor, importação completa do WhatsApp, grupos/canais, anexos, gestão de infraestrutura pelo dashboard OpenWA e início do próximo marco. Não há garantia de banimento zero nem de que uma conta restrita pela Meta será liberada pelo uso de OpenWA. O piloto de envio Meta continua registrado com erro de entrega `130497`.

Implementação depende da aprovação deste desenho e do plano subsequente. As decisões de detalhes que não alterem estes contratos ficam com o implementador.
