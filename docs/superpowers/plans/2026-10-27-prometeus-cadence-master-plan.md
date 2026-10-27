# Prometeus Cadence — índice mestre de implementação até 08B

**Baseline:**27/10/2026. **Origem:** escopo aprovado + solicitação expressa de escrever todos os planos antes de retomar implementação. **Status:** baseline técnica consolidada;06B.3 implementado e validado no escopo local/controlado. Próxima implementação: **06B.4**.

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
| 06B.4 | Identidade empresarial e tomadores de decisão | 06B.3 | [tarefas](2026-10-27-prometeus-cadence-06b4-company-people.md) | Planejado; não executado |
| 06D.1 | Autoria, variantes, anexos e publicação | 06B.4, 05 | [tarefas](2026-10-27-prometeus-cadence-06d1-message-authoring.md) | Planejado; não executado |
| 06D.2 | Canais, inbox e homologação de entrega | 06D.1 | [tarefas](2026-10-27-prometeus-cadence-06d2-channel-operation.md) | Planejado; não executado |
| 06B.5 | Jornada integrada de prospecção e cadência | 06B.3, 06B.4, 06D.1, 06D.2 | [tarefas](2026-10-27-prometeus-cadence-06b5-prospecting-journey.md) | Planejado; não executado |
| 06IA-H | Homologação das fontes e inteligência | 06B.5, 06IA | [tarefas](2026-10-27-prometeus-cadence-06iah-intelligence-homologation.md) | Planejado; não executado |
| 06C.2 | Dashboard, relatórios e execuções reconciliados | 06D.2, 06B.5, 06C.1 | [tarefas](2026-10-27-prometeus-cadence-06c2-reconciled-reports.md) | Planejado; não executado |
| 06C.3 | Notificações, preferências e resumos | 06C.2 | [tarefas](2026-10-27-prometeus-cadence-06c3-notifications.md) | Planejado; não executado |
| 06E.1 | Autenticador, sessões e administração de membros | 02, 06A-P, 06A-H | [tarefas](2026-10-27-prometeus-cadence-06e1-security-members.md) | Planejado; não executado |
| 06E.2 | Duplicados, fusão, privacidade e ciclo dos dados | 06E.1, 06B.4 | [tarefas](2026-10-27-prometeus-cadence-06e2-data-lifecycle.md) | Planejado; não executado |
| 06F | Assistente, busca, onboarding e ajuda | 06C.3, 06E.2, 06IA | [tarefas](2026-10-27-prometeus-cadence-06f-assistant-experience.md) | Planejado; não executado |
| 07C.1 | API, eventos e webhooks de saída | 06E.2, 06C.2 | [tarefas](2026-10-27-prometeus-cadence-07c1-api-webhooks.md) | Planejado; não executado |
| 07C.2 | Conectores de cliente e agenda/CRM | 07C.1 | [tarefas](2026-10-27-prometeus-cadence-07c2-customer-connectors.md) | Planejado; não executado |
| 07A.0 | Viabilidade e capacidades do LinkedIn | 06IA, 06E.1 | [tarefas](2026-10-27-prometeus-cadence-07a0-linkedin-feasibility.md) | Planejado; não executado |
| 07A.1 | Conexão, saúde e sincronização LinkedIn | 07A.0, 07C.2 | [tarefas](2026-10-27-prometeus-cadence-07a1-linkedin-connection.md) | Planejado; não executado |
| 07A.2 | Públicos, campanhas, convites e aceites LinkedIn | 07A.1, 06B.5 | [tarefas](2026-10-27-prometeus-cadence-07a2-linkedin-campaigns.md) | Planejado; não executado |
| 07A.3 | Pessoas, pipeline, mensagens e aprovações LinkedIn | 07A.2, 06D.2, 06B.4 | [tarefas](2026-10-27-prometeus-cadence-07a3-linkedin-conversations.md) | Planejado; não executado |
| 07C.3 | MCP autenticado e comandos revisados | 07C.1, 06F, 06E.1 | [tarefas](2026-10-27-prometeus-cadence-07c3-mcp.md) | Planejado; não executado |
| 07D | Descoberta condicional de scoring e Hot Now | 06C.2, 06B.5 | [tarefas](2026-10-27-prometeus-cadence-07d-scoring-discovery.md) | Planejado; gate include/exclude |
| 07B.1 | Configuração e ativação do agente SDR | 06F, 07C.2, 07A.3, 07C.3 | [tarefas](2026-10-27-prometeus-cadence-07b1-sdr-configuration.md) | Planejado; não executado |
| 07B.2 | Atendimento, memória e intervenção humana SDR | 07B.1, 06D.2 | [tarefas](2026-10-27-prometeus-cadence-07b2-sdr-conversation.md) | Planejado; não executado |
| 07B.3 | Agenda, CRM, acompanhamento e piloto SDR | 07B.2, 07C.2, 06C.3 | [tarefas](2026-10-27-prometeus-cadence-07b3-sdr-actions-pilot.md) | Planejado; não executado |
| 06G | Catálogo completo, anual, cupom e capacidade | 06A-H, 07A.3, 07B.3 | [tarefas](2026-10-27-prometeus-cadence-06g-commercial-catalog.md) | Planejado; não executado |
| 08A | Regressão integral de jornadas e UI/UX | 06G, 07B.3, 07C.3, 06A-V | [tarefas](2026-10-27-prometeus-cadence-08a-final-regression.md) | Planejado; não executado |
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
