# Prometeus Cadence — índice mestre de implementação até 08B

**Baseline:**27/10/2026. **Origem:** escopo aprovado + solicitação expressa de escrever todos os planos antes de retomar implementação. **Status:** baseline técnica consolidada;06IA-H implementado e validado no escopo local/controlado. Próxima implementação: **pendências locais do 08A**, antes do 08B (ordem atualizada em 05/11. 08A.1, 08A.2 e 08A.3 foram concluídos, com 103 de 126 itens aceitos na linha de base. Diário de Execuções implementado no 08A.4. Seletores e ajustes visuais foram implementados no 08A.5 e 08A.6. Permanecem estados transversais, aceite visual e homologações externas. 06G concluído e homologado no Stripe de teste; 07B.3 segue parcial, sem CRM e sem o piloto, que depende do usuário). Os gates de venda do SDR no 06G seguem fechados até o piloto. A habilitação real do LinkedIn depende de contrato e chave da Unipile, conta de teste e aceite jurídico.

**PRD:** [produto completo](../specs/2026-10-27-prometeus-cadence-complete-prd.md). **Contratos técnicos:** [arquitetura compartilhada](../specs/2026-10-27-prometeus-cadence-technical-contracts.md). **Roteiro histórico e vigente:** [roadmap](2026-10-20-prometeus-cadence-roadmap.md). **Manifesto:** [JSON](2026-10-27-prometeus-cadence-implementation-manifest.json).

## Como executar sem reabrir o escopo

Consolidação verificada e revisão do desenho: [relatório](../../validation/2026-10-27-complete-planning.md). A verificação é dos documentos; não representa testes de implementação nem homologação de fornecedores.

As famílias 01–08 preservam o histórico; não existe 09 definido. Letras/sufixos representam áreas/pacotes, não uma sequência numérica estrita. Ler PRD+contratos+spec da área+plano do pacote. Executar nativamente uma tarefa verificável por vez, reaproveitando os serviços existentes. Resolver decisões técnicas locais dentro do contrato; registrar mudança apenas se uma evidência externa exigir alternativa. Não avançar o status por ter escrito o plano.

## Pacotes restantes e dependências

A ordem abaixo é uma sequência de integração.06A-V é contínuo;07A.0 é gate antecipável e deve ocorrer antes de 07A.1;07D é condicional. Dependências concluídas são lidas em seus relatórios, sem refazer a implementação.

| Pacote | Entrega | Depende de | Plano | Situação |
|---|---|---|---|---|
| 06A-V | Fechamento visual contínuo e diferenças residuais | contínuo | [tarefas](2026-10-27-prometeus-cadence-06av-visual-closure.md) | Planejado; porta contínua |
| 06B.3 | Investigação da empresa e redes | 06IA, 06B.1, 06B.2 | [tarefas](2026-10-27-prometeus-cadence-06b3-company-research.md) | Concluído local/controlado; [aceite06B.3](../../validation/06b3-company-research.md) |
| 06B.4 | Identidade empresarial e tomadores de decisão | 06B.3 | [tarefas](2026-10-27-prometeus-cadence-06b4-company-people.md) | Concluído local/controlado; [aceite06B.4](../../validation/06b4-company-people.md) |
| 06D.1 | Autoria, variantes, anexos e publicação | 06B.4, 05 | [tarefas](2026-10-27-prometeus-cadence-06d1-message-authoring.md) | Concluído local/controlado; [aceite06D.1](../../validation/06d1-message-authoring.md) |
| 06D.2 | Canais, inbox e homologação de entrega | 06D.1 | [tarefas](2026-10-27-prometeus-cadence-06d2-channel-operation.md) | Concluído local/controlado; piloto externo permanece gate |
| 06B.5 | Jornada integrada de prospecção e cadência | 06B.3, 06B.4, 06D.1, 06D.2 | [tarefas](2026-10-27-prometeus-cadence-06b5-prospecting-journey.md) | Concluído local/controlado; acurácia live permanece gate06IA-H |
| 06IA-H | Homologação das fontes e inteligência | 06B.5, 06IA | [tarefas](2026-10-27-prometeus-cadence-06iah-intelligence-homologation.md) | Concluído local/controlado; piloto real/acurácia externa pendentes |
| 06C.2 | Dashboard, relatórios e execuções reconciliados | 06D.2, 06B.5, 06C.1 | [tarefas](2026-10-27-prometeus-cadence-06c2-reconciled-reports.md) | Concluído local/controlado29/10; [aceite](../../validation/06c2-reconciled-reports.md) |
| 06C.3 | Notificações, preferências e resumos | 06C.2 | [tarefas](2026-10-27-prometeus-cadence-06c3-notifications.md) | Concluído local/controlado30/10; [aceite](../../validation/06c3-notifications.md) |
| 06E.1 | Autenticador, sessões e administração de membros | 02, 06A-P, 06A-H | [tarefas](2026-10-27-prometeus-cadence-06e1-security-members.md) | Concluído local/controlado02/11; [aceite](../../validation/06e1-security-members.md) |
| 06E.2 | Duplicados, fusão, privacidade e ciclo dos dados | 06E.1, 06B.4 | [tarefas](2026-10-27-prometeus-cadence-06e2-data-lifecycle.md) | Concluído local/controlado02/11; [aceite](../../validation/06e2-data-lifecycle.md) |
| 06F | Assistente, busca, onboarding e ajuda | 06C.3, 06E.2, 06IA | [tarefas](2026-10-27-prometeus-cadence-06f-assistant-experience.md) | Concluído local/controlado em dois pacotes: [06F.1](2026-11-02-prometeus-cadence-06f1-assistant-search.md) e [06F.2](2026-11-02-prometeus-cadence-06f2-assistant-commands.md) |
| 07C.1 | API, eventos e webhooks de saída | 06E.2, 06C.2 | [tarefas](2026-10-27-prometeus-cadence-07c1-api-webhooks.md) | Concluído local/controlado em dois pacotes: [07C.1a](2026-11-02-prometeus-cadence-07c1a-webhooks.md) e [07C.1b](2026-11-02-prometeus-cadence-07c1b-public-api.md) |
| 07C.2 | Conectores de cliente e agenda/CRM | 07C.1 | [tarefas](2026-10-27-prometeus-cadence-07c2-customer-connectors.md) | Concluídos local/controlado: [07C.2a](2026-11-02-prometeus-cadence-07c2a-connectors.md), [07C.2b](2026-11-03-prometeus-cadence-07c2b-google-sheets.md) e [07C.2c](2026-11-03-prometeus-cadence-07c2c-google-calendar.md); FunnelsFlow/MeetFlow sem contrato oficial |
| 07A.0 | Viabilidade e capacidades do LinkedIn | 06IA, 06E.1 | [tarefas](2026-10-27-prometeus-cadence-07a0-linkedin-feasibility.md) | Concluído local/controlado em 03/11; rota decidida: conector Unipile ([aceite](../../validation/07a0-linkedin-feasibility.md)) |
| 07A.1 | Conexão, saúde e sincronização LinkedIn | 07A.0, 07C.2 | [tarefas](2026-10-27-prometeus-cadence-07a1-linkedin-connection.md) | Concluído local/controlado em 03/11 com a Unipile simulada ([aceite](../../validation/07a1-linkedin-connection.md)) |
| 07A.2 | Públicos, campanhas, convites e aceites LinkedIn | 07A.1, 06B.5 | [tarefas](2026-10-27-prometeus-cadence-07a2-linkedin-campaigns.md) | Concluído local/controlado em 03/11 com a Unipile simulada ([aceite](../../validation/07a2-linkedin-campaigns.md)) |
| 07A.3 | Pessoas, pipeline, mensagens e aprovações LinkedIn | 07A.2, 06D.2, 06B.4 | [tarefas](2026-10-27-prometeus-cadence-07a3-linkedin-conversations.md) | Dividido: 07A.3a concluído local/controlado em 03/11 ([aceite](../../validation/07a3a-linkedin-conversations.md)); 07A.3b concluído em 04/11 ([aceite](../../validation/07a3b-linkedin-sequences.md)); 07A.3c concluído em 04/11 ([aceite](../../validation/07a3c-linkedin-approvals.md)). Pacote concluído local/controlado |
| 07C.3 | MCP autenticado e comandos revisados | 07C.1, 06F, 06E.1 | [tarefas](2026-10-27-prometeus-cadence-07c3-mcp.md) | Concluído local/controlado em 04/11, em duas partes: 07C.3a ([aceite](../../validation/07c3a-mcp.md)) e 07C.3b ([aceite](../../validation/07c3b-mcp-commands.md)); clientes reais não homologados |
| 07D | Descoberta condicional de scoring e Hot Now | 06C.2, 06B.5 | [tarefas](2026-10-27-prometeus-cadence-07d-scoring-discovery.md) | Planejado; gate include/exclude |
| 07B.1 | Configuração e ativação do agente SDR | 06F, 07C.2, 07A.3, 07C.3 | [tarefas](2026-10-27-prometeus-cadence-07b1-sdr-configuration.md) | Concluído local/controlado em 04/11 ([aceite](../../validation/07b1-sdr-configuration.md)); atendimento real no 07B.2 |
| 07B.2 | Atendimento, memória e intervenção humana SDR | 07B.1, 06D.2 | [tarefas](2026-10-27-prometeus-cadence-07b2-sdr-conversation.md) | Concluído local/controlado em 04/11 ([aceite](../../validation/07b2-sdr-conversation.md)); só WhatsApp, sem piloto real |
| 07B.3 | Agenda, CRM, acompanhamento e piloto SDR | 07B.2, 07C.2, 06C.3 | [tarefas](2026-10-27-prometeus-cadence-07b3-sdr-actions-pilot.md) | Parcial em 04/11 ([relatório](../../validation/07b3-sdr-actions.md)): agenda e follow-up local/controlado; sem CRM (não há conector) e sem piloto; SDR sem aceite |
| 06G | Catálogo completo, anual, cupom e capacidade | 06A-H, 07A.3, 07B.3 | [tarefas](2026-10-27-prometeus-cadence-06g-commercial-catalog.md) | Parcial: Concluído: [anual](../../validation/06g1-annual.md), [capacidade](../../validation/06g2-capacity.md) e [cupom](../../validation/06g3-coupon.md); [homologado no Stripe de teste](../../validation/06g-stripe-homologation.md) |
| 08A | Regressão integral de jornadas e UI/UX | 06G, 07B.3, 07C.3, 06A-V | [tarefas](2026-10-27-prometeus-cadence-08a-final-regression.md) | Parcial: [08A.1](../../validation/08a1-coverage-sweep.md) , [08A.2](../../validation/08a2-journeys.md) e [08A.3](../../validation/08a3-remaining.md) concluídos. [08A.4](../../validation/08a4-execution-diary.md) cobre o diário, [08A.5](../../validation/08a5-selectors.md) os seletores e [08A.6](../../validation/08a6-local-closure.md) os ajustes e provas locais. Aceite integral pendente |
| 08B | Homologação e operação de produção pública | 08A | [tarefas](2026-10-27-prometeus-cadence-08b-public-production.md) | Planejado; não executado |

## Aceites históricos e pendências herdadas

01/02/03/03B/04/05/06A mantêm seus próprios relatórios emdocs/validation; não recebem aceites novos por esta consolidação.06A-P/06A-H/06C.1/06B.1/06B.2/06IA já têm planos e validações. Ler a última continuidade do roteiro, não a frase “próximo” em um relatório histórico.

Pendências herdadas têm dono: acurácia/fornecedor pago→06IA-H; visual residual→06A-V+área; ida/volta de canal→06D.2; contexto/ajudas operacionais→06F; documentos jurídicos definitivos/origem pública/SMTP/proxy→08B;OAuth comercial da infraestrutura→08B; backfill 40 grants→08B; carga/restore/produção→08B. Limitação de prova da referência não desaparece por implementar regra própria.

## MatrizPRD → pacote → UI → contrato → teste

| Requisito | Pacotes responsáveis | Evidência/validação exigida |
|---|---|---|
| R01 | 06E.1, 08A, 08B | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R02 | 06B.3 | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R03 | 06B.3 | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R04 | 06B.4 | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R05 | 06B.3, 06B.4, 06B.5 | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R06 | 06IA-H | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R07 | 06D.1, 06B.5, 08A | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R08 | 06D.1 | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R09 | 06D.2, 08A | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R10 | 06C.2 | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R11 | 06C.3 | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R12 | 06E.1 | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R13 | 06E.2 | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R14 | 06F | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R15 | 07C.1 | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R16 | 07C.2 | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R17 | 07C.3 | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R18 | 07A.0, 07A.1, 07A.2, 07A.3, 08A | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R19 | 07B.1 | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R20 | 07B.2 | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R21 | 07B.3, 08A | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R22 | 06G | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R23 | 07D | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R24 | 06A-V, 08A | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R25 | 08B | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |
| R26 | 08B | Plano de cada pacote define arquivos, rotas/estados, serviços, testes focados e relatório de aceite;08A audita cobertura final. |

## Gates que não mudam o escopo automaticamente

| Entrada/barreira | Dono | Comportamento sem entrada | Prova para liberar |
|---|---|---|---|
| Actor/build/custo/permissões de fonte nova | admin da plataforma,06B.3/4+06IA-H | fonte indisponível; resultado parcialhonesto | contrato tipado, amostra/piloto, teto/custo e ausência de fato sem fonte |
| Convite/mensagem LinkedIn |07A.0 | ações não concedidas bloqueadas; não vender automação fictícia | habilitação e efeitooperacional próprio ou alternativa equivalente registrada |
| CRM/Apollo/Sheets/agenda/reuniões |07C.2 | conector não operacional indicado; nenhuma credencial pedida em tela fictícia | conta do cliente, contrato e efeito externo reconciliado |
| OAuth hospedado de LLM |08B/admin da plataforma | política exige provedor central apto; cliente não fornece chave | habilitação própria ou API central suportada |
| Domínio/host/DNS/SMTP/documentos definitivos |08B/operador | release público bloqueado, preparação local continua | checklist e piloto/restore/load de ambiente real |
| Stripe live |08B/operador | default test; nenhum efeito financeiro real | modo/chaves/catalogo/webhook corretos, autorização expressa e piloto próprio |

## Protocolo de mudança e estado estável

Troca de adaptador sem mudar jornada/resultado: registrar evidência, alternativa, custo, capacidade e testes; atualizar spec/plan afetados e manifesto. Mudança de escopo comercial/UX principal/direito recorrente exige decisão do operador. Nova dependência/skill/plugin segue AGENTS e consulta O Setup; não adicionar ferramentas para compensar documento incompleto.

Nenhum plano presume instalação/contratação automática. Valores/limites técnicos propostos estão explícitos no desenho; manter defaults seguros e limites mais restritivos dos canais. O escopo está escrito; comprovação operacional futura pode reprovar um pacote sem redefinir a finalidade do produto.

Continuidade06D.1: autoria/variantes/anexos/publicação concluídos no contrato local;06D.2 é o próximo. Retenção automática de arquivos→06E.2/08B, capacidades de anexos fora de e-mail e ida/volta real→06D.2; volume/backup/antimalware/carga→08B; estados inacessíveis da referência→08A+área. A recuperação básica de quota já foi corrigida em06D.1.

Continuidade06D.2 em28/10:comprovantes suportados e observação sem novo envio;342/383 testes,36 capturas, uma revisão independente/dois Important corrigidos. Menor de erro residual do popup→06F. Ida/volta live e domínio/tokens públicos→gate explícito de homologação/08B; nenhuma execução externa foi declarada feita. Próximo06B.5, sem alteração das dependências restantes. [Aceite](../../validation/06d2-channel-operation.md).

Continuidade06B.5 em28/10: jornada com revisão, recuperação por empresa/módulo, isolamentoSQL e um rascunho vinculado;346/402/19testes,69capturas. Uma revisão independente/oito Important corrigidos. Menor herdado06B.3 de seleção inicial do lote→06F. Próximo06IA-H, preservando demais dependências e gates públicos. [Aceite](../../validation/06b5-prospecting-journey.md).

Continuidade06IA-H em28/10: 351/351 unitários,421/421 integrações completas,19/19 focadas, build/tipos aprovados;30casos sintéticos/60saídas e9capturas mascaradas desktop/mobile. Uma revisão independente;dois Important corrigidos com regressões RED→GREEN e um menor de arredondamento adiado para08A. Piloto empírico pago permanece gate06IA-H/08B; a infraestrutura de avaliação local está entregue, sem certificação comercial de acurácia. Próximo06C.2. [Aceite](../../validation/06iah-intelligence-homologation.md).

Continuidade06C.3 em30/10:363unitários/447integrações/15focadas,48capturas mascaradas, uma revisão independente e sete Important corrigidos com RED→GREEN. Um menor de prova positiva de isolamento semanal→08A. Preferências/feed/resumos privados e serviço contínuo; entrega externa/políticas da referência não observadas seguem gates. Próximo06E.1 — autenticador, sessões e membros. [Aceite](../../validation/06c3-notifications.md).

Continuidade06E.1 em02/11: TOTP/backup BetterAuth com guardas de prova/replay, sessões pendentes bloqueadas em todas as entradas, convites/papéis/remoção serializados com revisão/idempotência e último owner por trigger. 466/466 integrações; uma revisão independente/um Important corrigido RED→GREEN; dois menores→08A. Diferenças de código por e-mail/confiança30dias/senha8 da referência permanecem na matriz08A. Próximo06E.2 — duplicados, fusão, privacidade e ciclo dos dados. [Aceite](../../validation/06e1-security-members.md).

Continuidade06E.2 em02/11: duplicados por chave forte na base inteira, fusão revisada por grupo com consentimento mais restritivo e desfazer de7 dias com 409 sobre trabalho novo; retenção do texto somente do dono com APAGAR e purga em lotes; exclusão com tombstone sem conteúdo e purga de IA. 477/477 integrações; uma revisão independente/seis Important corrigidos RED→GREEN (092a); menores→08A. Exportação privada do desenho não implementada e não anunciada. Próximo06F — assistente, busca, onboarding e ajuda. [Aceite](../../validation/06e2-data-lifecycle.md).

Continuidade 06F.1 em 02/11: 06F dividido em dois pacotes. 06F.1 entrega:
- busca global Ctrl K sobre leads, listas, cadências e páginas, isolada por workspace e com cursor;
- assistente lateral fiel à referência, com card "Pra hoje", respostas pela ajuda local e pelos fatos da conta, citações restritas às fontes, fallback da Central de Ajuda e limites diários em SQL;
- Central de Ajuda local.

Uma revisão independente encontrou três Important, corrigidos RED→GREEN na 093a; menores→08A. A IA real da plataforma estava sem cota da assinatura, então nenhuma resposta da IA foi observada na QA. Próximo **06F.2**: comandos revisados, `onboarding_progress`, tours e os menores herdados (06B.3, 06B.5, 06D.2). [Aceite](../../validation/06f1-assistant-search.md).

Continuidade 06F.2 em 02/11: o assistente propõe 4 ações fechadas (público com automações pausadas, opções de cadência, qualificação de lista e rascunho de resposta). Cada uma passa pela revisão do serviço da área, com confirmação idempotente e 0 envios. "Como funciona" abre o passeio da área, e o progresso de passeios é gravado por usuário. Os menores 06B.3 e 06D.2 foram fechados. Uma revisão independente encontrou seis Important, corrigidos RED→GREEN na 094a; menores→08A. A IA real seguiu sem cota da assinatura da plataforma. **06F concluído.** Próximo **07C.1 — API, eventos e webhooks de saída**. [Aceite](../../validation/06f2-assistant-commands.md).

Continuidade 07C.1a em 02/11: o 07C.1 foi dividido. O 07C.1a entrega webhooks de saída fiéis à página "Webhooks e API":
- eventos gravados por trigger na transação do efeito;
- destinos revisados, com segredo cifrado mostrado uma vez;
- lane `integrations` com DNS/IP públicos a cada tentativa, IP fixado, sem seguir redirecionamento e assinatura HMAC;
- retentativas só para 429/5xx/rede até 24 h, e atenção sem laço em 401/403/410;
- justiça por destino e retenção de 30 dias.

Uma revisão independente encontrou seis Important, corrigidos RED→GREEN na 095a; menores→08A. Nenhum POST externo foi feito. Próximo **07C.1b — API pública com tokens escopados**. [Aceite](../../validation/07c1a-webhooks.md).

Continuidade 07C.1b em 02/11: API pública somente leitura com chaves escopadas:
- token mostrado uma vez e guardado como digest; gerar nova e revogar valem na hora;
- a chave age como um criador que continua proprietário ou administrador;
- `/api/v1/leads` e `/api/v1/events` com cursor retomável, atraso de commit e limite de 120/min.

Uma revisão independente encontrou quatro Important, corrigidos RED→GREEN na 096a; menores→08A. **07C.1 concluído.** Próximo **07C.2**. [Aceite](../../validation/07c1b-public-api.md).

Continuidade 07C.2a em 03/11: o 07C.2 foi dividido em 07C.2a (cofre e Apollo), 07C.2b (Google Sheets) e 07C.2c (agenda). O 07C.2a entrega a conexão Apollo com a chave do cliente:
- a chave vira uma referência de uso único, é conferida no Apollo e fica cifrada; só o worker a decifra;
- buscas e automações usam a conexão revisada, e revogar depois da revisão impede a chamada;
- a chave central passa a ser opcional por workspace.

Uma revisão independente encontrou quatro Important, corrigidos RED→GREEN na 097a; menores→08A. Próximo **07C.2b — Google Sheets**. [Aceite](../../validation/07c2a-connectors.md).

Continuidade 07C.2b em 03/11: Google Sheets com a conta Google do cliente:
- OAuth com PKCE e só `drive.file`; tokens cifrados;
- uma linha por lead pela coluna "ID Cadence", sem duplicata em repetições;
- falhas da planilha seguram a fila com ação de recuperação; lane próprio `sheets`.

Uma revisão independente encontrou quatro Important, corrigidos RED→GREEN na 098a; menores→08A/08B. Próximo **07C.2c — agenda**. [Aceite](../../validation/07c2b-google-sheets.md).

Continuidade 07C.2c em 03/11: Google Agenda com a conta Google do cliente:
- OAuth com PKCE (`calendar.freebusy` e `calendar.events.owned`), no fluxo Google comum ao Sheets;
- disponibilidade no fuso e horários livres com `slotId` selado por 5 min;
- reserva local com trava e id de evento determinístico; uma resposta perdida reconcilia sem segundo evento; cancelamento idempotente.

A página da conexão fica fora do grid de Apps, como na referência; quem vai usar a agenda é o 07B.3. Uma revisão independente encontrou três Important, corrigidos RED→GREEN na 099a. O 07C.2 está fechado; FunnelsFlow e MeetFlow seguem como barreira. Próximo **07A.0 — viabilidade do LinkedIn**. [Aceite](../../validation/07c2c-google-calendar.md).

Continuidade 07A.0 em 03/11: entregue o gate de capacidades do LinkedIn.
- **Atestado de plataforma:** um adaptador ativo, com validade de até 400 dias, revogável e com evidência por capacidade. A API oficial nunca recebe mensagem automática.
- **Trava:** `requireLinkedinCapability`, que vê vencimento e revogação mesmo dentro da transação.
- **Inventário:** 20 ações da referência, cada uma com sua capacidade.
- **UI:** mostra o motivo vindo do servidor.

A revisão independente encontrou três Important, corrigidos RED→GREEN na 100a. A decisão está com o usuário: a API oficial, só assistida, não opera o módulo; um conector de conta (recomendada a Unipile como primeira avaliação) reproduz a referência, mas fere o Contrato do Usuário do LinkedIn. O **07A.1 só começa com a rota, o fornecedor, a conta de teste e o aceite jurídico definidos**. [Aceite](../../validation/07a0-linkedin-feasibility.md).

Continuidade 07A.1 em 03/11: conexão da conta LinkedIn pela Unipile, com o fornecedor simulado nos testes.
- **Conexão:** termo de risco versionado e login hospedado. A conta só é vinculada com o aviso do fornecedor mais o retorno da sessão que iniciou.
- **Conta:** uma por workspace e nunca compartilhada entre workspaces.
- **Manutenção:** verificação com lease e backoff; desconexão imediata, com remoção da sessão no fornecedor; limpeza de sessões órfãs; lane `linkedin` no worker.

A revisão independente encontrou quatro Important, corrigidos RED→GREEN na 101a. Os principais eram o link encaminhado e as sessões órfãs. A habilitação real aguarda o contrato e a chave da Unipile, a conta de teste e a leitura jurídica do termo. [Aceite](../../validation/07a1-linkedin-connection.md).

Continuidade 07A.2 em 03/11: campanhas de convite no LinkedIn, com o fornecedor simulado nos testes.
- **Editor:** o rascunho guarda todos os controles. "Explorar público" é real, e um filtro que não chega ao LinkedIn é recusado antes de qualquer chamada. A revisão separa o público real da estimativa, e só owner/admin ativa.
- **Envio:** o worker coleta o público e envia convites com teto de 12 por dia por membro LinkedIn, somando campanhas. Um convite por pessoa, em dias úteis das 9h às 18h. Um envio incerto nunca é reenviado.
- **Aceite e expiração:** o aceite comprovado gera um lead e um evento. O convite vencido é retirado, e o perfil é conferido antes de virar não aceite.

A revisão independente encontrou seis Important, corrigidos RED→GREEN na 102a. Os principais eram o livro de convites que zerava na reconexão e o aceite que virava não aceite. Os leads de aceite não consomem crédito; a cobrança por conta conectada é decisão pendente do usuário. [Aceite](../../validation/07a2-linkedin-campaigns.md).

Continuidade 07A.3a em 03/11: o 07A.3 foi dividido em três partes.
- **07A.3a (concluído com a Unipile simulada):** pessoas e pipeline reais, conversas sincronizadas e resposta revisada (token de 60 s pelo mesmo usuário, sem reenvio), opt-out que interrompe convites e mensagens.
- **Pendentes:** 07A.3b (cadência pós-aceite e templates) e 07A.3c (aprovações).

A revisão independente encontrou cinco Important, corrigidos RED→GREEN na 103a. [Aceite](../../validation/07a3a-linkedin-conversations.md).

Continuidade 07A.3b em 04/11 (concluído com a Unipile simulada):
- **Templates:** templates do LinkedIn de convite e de mensagem.
- **Cadência:** cadência pós-aceite por campanha, automática ou assistida (rascunho revisado), até 30 por dia por membro, com 5 minutos de intervalo, na janela comercial.
- **Mensagem por pessoa:** começa a conversa com quem aceitou.

A revisão independente encontrou um High e quatro menores, corrigidos RED→GREEN na 104a. Próximo: 07A.3c. [Aceite](../../validation/07a3b-linkedin-sequences.md).

Continuidade 07A.3c em 04/11 (concluído com a Unipile e a IA simuladas): o passo "Comentar o post mais recente" da cadência pós-aceite.
- **Fluxo:** a IA central escreve o comentário, que espera em Aprovações e só é publicado depois que owner, admin ou operador aprova (editável, com reteste e sem repetição).
- **Pacote:** com isso, o 07A.3 está completo. Próximo: 07C.3.

A revisão independente encontrou dois High, um Medium e dois Low, corrigidos RED→GREEN na 105a. [Aceite](../../validation/07a3c-linkedin-approvals.md).

Continuidade 07C.3a em 04/11 (concluído local/controlado):
- **Autorização:** servidor OAuth próprio (registro dinâmico, PKCE S256, refresh rotativo com revogação no reuso).
- **Endpoint e página:** endpoint MCP Streamable HTTP com ferramentas de leitura (contatos, execuções e métricas), e `/settings/mcp` com a URL real, as conexões e a revogação.

A revisão independente encontrou dois Medium e sete Low, corrigidos na 106a. Clientes reais não foram homologados. Próximo: 07C.3b. [Aceite](../../validation/07c3a-mcp.md).

Continuidade 07C.3b em 04/11 (concluído local/controlado):
- **Comandos revisados:** o MCP prepara cadência, qualificação, público com automações pausadas e rascunho de resposta como propostas do assistente, ligadas à conexão; nada envia, publica ou ativa.
- **Confirmação:** pelo link `/mcp/review/<id>` no app ou, se a pessoa marcar o escopo opcional `actions.confirm` no consentimento, pelo próprio cliente com o token da revisão.

A revisão independente encontrou três Medium e oito Low, corrigidos na 107a e no serviço. Com isso o 07C.3 está completo. Próximo: 07B.1. [Aceite](../../validation/07c3b-mcp-commands.md).

Continuidade 07B.1 em 04/11 (concluído local/controlado):
- **Configuração:** agentes do SDR em workspaces Pro, nos quatro blocos da referência (definição, script, canal e passagem), com horário, limites e base de conhecimento privada aprovada.
- **Simulação e ativação:** simulação sem envio e ativação revisada com snapshot imutável, que vira pausa ou perde validade quando algo muda.

A revisão independente encontrou dois High, oito Medium e oito Low, corrigidos na 108a. O atendimento das conversas é o 07B.2. Próximo: 07B.2. [Aceite](../../validation/07b1-sdr-configuration.md).

Continuidade 07B.2 em 04/11 (concluído local/controlado):
- **Atendimento:** um turno por mensagem na lane `sdr`; a IA prepara um rascunho que espera aprovação na inbox do WhatsApp.
- **Intervenção:** assumir e devolver; resposta manual assume a conversa.
- **Cobrança:** 1 unidade reservada por turno e consumida na aprovação.

A revisão independente encontrou dois High, nove Medium e onze Low, corrigidos na 109a, exceto os quatro itens aceitos e registrados. Sem piloto real, IA real ou e-mail. Próximo: 07B.3. [Aceite](../../validation/07b2-sdr-conversation.md).

Continuidade 07B.3 em 04/11 (parcial, sem aceite do SDR):
- **Agenda:** horários reais e reserva pelo serviço do 07C.2c, dentro da conversa.
- **Follow-up:** autorização registrada por proprietário ou administrador, até 2 retornos com aprovação, só no WhatsApp gerenciado.
- **Pendências:** CRM não existe (nenhum conector); piloto depende de contas e autorização do usuário.

A revisão independente encontrou cinco High, doze Medium e oito Low, tratados na 110b, com três itens aceitos e registrados. [Relatório](../../validation/07b3-sdr-actions.md).
