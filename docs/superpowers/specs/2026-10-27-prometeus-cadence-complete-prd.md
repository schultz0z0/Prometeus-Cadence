# Prometeus Cadence — PRD consolidado até a produção pública

**Baseline:**27/10/2026. **Escopo:** extensão aprovada em 27/10 e pedidos acumulados do operador. **Entrega desta sessão:** documentação; nenhum pacote de produto declarado implementado por este PRD.

## Objetivo e público

SaaS multiempresa para encontrar empresas e decisores, entender seu contexto, qualificar contatos e conduzir abordagens revisadas por WhatsApp/e-mail; LinkedIn conectado e atendimento SDR são módulos distintos. O cliente se cadastra, contrata e usa a plataforma sem administrar Apify ou LLM. O dono do SaaS administra infraestrutura, fontes, modelos, instruções, custos e disponibilidade.

A experiência inicial reproduz visual, fluxos e funcionalidades observáveis do CadenceFlow. Backend próprio funcional/testado é suficiente quando a implementação interna do concorrente não é observável. Réplica visual não autoriza métricas falsas, botões sem executor ou promessas de capacidade de um fornecedor não habilitado. Personalização visual posterior não faz parte desta baseline.

## Decisões preservadas e limites de escopo

- Trial de 7 dias sem cobrança automática; Essential R$397/mês ePro R$897/mês; adicionais de consumo pré-pagos, sem expiração de créditos. Capacidade adicional recorrente acompanha sua vigência e não vira direito vitalício.
- Meta oficial permanece como método; OpenWA gerenciado com QR no app substitui Twilio. Risco de bloqueio informado; limites iniciais 20 mensagens/dia,5 novos contatos autorizados/dia e intervalo 60–180 s continuam aplicáveis.
- Apify/LLM são centrais. Conta/canal pessoal ou empresarial do cliente é isolado por workspace. Admin da plataforma não é sinônimo de owner do cliente.
- Dados públicos e resultados de fornecedor não comprovam automaticamente titularidade, atualidade, entrega, WhatsApp ativo ou consentimento de envio. Contato ausente permanece ausente.
- Investigação no LinkedIn como fonte não equivale a conexão operacional da identidade LinkedIn. Permissões concedidas determinam ações disponíveis; OAuth não as concede implicitamente.
- SDR é opcional e não é ligado ao receber uma resposta. Cadência interrompe follow-up nessa situação; humano assume ouSDR previamente autorizado atende.
- Não reconstruir um SaaS externo de reuniões nem oferecer gerenciamento editorial completo do perfilLinkedIn.07D depende de descoberta atual; fora do compromisso obrigatório até a decisão registrada.

## Jornadas e requisitos rastreáveis

| Requisito | Jornada e resultado esperado | Dono restante |
|---|---|---|
| R01 | Cadastro/verificação/workspace/plano persistentes; erros, convites e recuperação reais; identidade jurídica e origem pública corretas na liberação | Aceites 02/06A-P preservados;06E.1/08B revalidam |
| R02 | Nicho/local/objetivo → empresas de Maps/WEB/CNPJ/fontes habilitadas; quantidade, destino e consumo revisados antes de iniciar | Aceites 03/06B.1;06B.3 |
| R03 | Site e redes da mesma empresa → contexto, contatos comerciais e evidência por campo; vínculos conflitantes não são aplicados silenciosamente |06B.3 |
| R04 | Site/razão social → CNPJ/empresa correta → sócios e gestores → perfis pessoais/LinkedIn e contatos atribuídos, sem confundir homônimos |06B.4 |
| R05 | Pesquisa adaptativa continua parcialmente quando uma fonte falha; cancelamento/retomada não repetem consumo ou consultas já concluídas |06B.3/4/5 |
| R06 | LLM tradicional usa instruções gerais versionadas + contexto/ICP/produto privado + pedido + evidências; JEV avalia dentro de contrato estruturado |06IA aceito;06IA-H avalia fontes/qualidade |
| R07 | Qualificação e fatos revisáveis; lista e cadência sugeridas com variáveis, sem criar/envios pelo simples pedido de sugestão |06B.5/06D.1 |
| R08 | Criação manual/IA/assistente/importação de modelo conforme inventário; etapas, variantes, anexos, agenda e publicação real/revisada |06D.1 |
| R09 | Canais/inbox/threads/respostas/opt-out/parada; entrega/recibo apenas quando o canal fornece prova; falhas incertas reconciliadas |06D.2 |
| R10 | Dashboard, relatórios e execuções compartilham fatos reais, período/fuso/filtros e detalhes; zero distingue indisponibilidade |06C.2 |
| R11 | Contadores, feed, som, preferências/eventos, silêncio e resumos agendados têm executores e destinos autorizados |06C.3 |
| R12 | Membros/assentos/convites, últimoowner, TOTP/recuperação e revogação em rotas e serviços, não só no menu |06E.1 |
| R13 | Duplicatas/fusão/desfazer, exportação, retenção e exclusão com auditoria; conteúdo excluído fora de busca/cache/IA |06E.2 |
| R14 | Assistente contextual propõe comandos com confirmação; busca, atalhos, tours, checklist e ajuda têm destinos funcionais |06F |
| R15 | Contratos/eventos, API e webhooks autenticados com fila/retry/histórico/revogação, sem executar URL privada indicada por cliente |07C.1 |
| R16 | Sheets/CRM/Apollo/agenda/integração de reuniões observadas: conexão, mapeamento, sincronização, falha e desconexão isoladas |07C.2 |
| R17 | MCP expõe ferramentas reais autorizadas e propostas revisadas pelos mesmos contratos da UI, com tokens/escopos/revogação |07C.3 |
| R18 | LinkedIn: provar capacidade antes de oferecer ações; conexão saudável/revogável, público, campanhas, convites/aceites, pessoas/pipeline e mensagens/aprovações |07A.0/1/2/3 |
| R19 | SDR: contexto/roteiro/conhecimento/horários/canais/limites; revisão e ativação explícita |07B.1 |
| R20 | SDR: responder/qualificar por conversa, abster/encaminhar, respeitar humano/opt-out, limites e canal; memória privada |07B.2 |
| R21 | SDR: disponibilidade/reserva real de agenda, CRM, acompanhamento autorizado e piloto de ida/volta |07B.3 |
| R22 | Anual/cupom e capacidade adicional com revisão/valores/vigência; reduzir capacidade não apaga dados; só vender módulo operacional |06G |
| R23 | Scoring/HotNow somente se descoberta confirmar oferta/contrato; sem introduzir número promocional como medição |07D condicional |
| R24 | Cada tela/subtela/aba/menu/popup/estado tem correspondência visual e operação; mobile/teclado/tema/texto preservados |06A-V por pacote;08A consolida |
| R25 | Operação contínua limitada/fair por cliente, recuperação de provedor/processo, sem duplicação de efeitos ou terminais visíveis |06C.1 aceito;08B |
| R26 | Produção pública: origem/HTTPS/proxy/autenticação, segredos, quotas/custos, backups/restauração, observabilidade, migração/rollback e piloto controlado |08B |

## Papéis e autoridade

| Ator | Pode | Não pode |
|---|---|---|
| Administrador da plataforma | Gerir infraestrutura central e versões de fontes/modelos; acompanhar saúde e custo agregado, com auditoria | Conceder essa autoridade pelo cadastro de cliente ou compartilhar dados privados entre clientes |
| Owner/admin do workspace | Contexto, equipe, canais/conectores próprios, políticas e publicação conforme permissões atuais | Alterar credenciais/modelo central, escalar permissões, ignorar limitações de provedor |
| Operador | Consultar dados autorizados, preparar/editar dados e responder conforme capacidades atuais | Administrar membros/canais/cobrança/publicação sem permissão correspondente |
| Worker/integração externa | Executar operação delimitada por lease/token/escopo, com revisão e época ainda válidas | Agir como owner global ou reutilizar revisão/recurso de outro workspace |

## Experiência e operação de ponta a ponta

1. Configurar contexto da empresa e canais necessários; cliente vê disponibilidade de produto, não detalhes de Actor ou chaveLLM.
2. Informar público/local/objetivo e revisar destino/quantidade/estimativa; iniciar pesquisa após confirmação.
3. Ver progresso por etapa, resultados parciais, fontes e limites. Revisar identidade/fatos/qualificação e aceitar aplicação à base.
4. Revisar sugestão de cadência com variáveis válidas, etapas e canais; editar, salvar rascunho e publicar conscientemente.
5. Acompanhar execução por contato/etapa, inbox e métricas. Resposta/opt-out impedem novas abordagens pendentes; encaminhamento humano/SDR tem dono explícito.
6. Conduzir relacionamentoLinkedIn somente nas capacidades concedidas; agenda/CRM refletem efeitos confirmados. Consultar consumo/cobrança; exportar ou eliminar dados com as regras próprias.

## Modelo lógico e estados

Manter lead/lista/contexto/produto/job/publicação/enrollment/conversa/mensagem existentes. Acrescentar registros relacionais privados de pesquisa, fatos/fontes, pessoas e vínculo com empresa; versões de conteúdo/anexos; projeções/notificações; políticas e solicitações de dados; conectores/entregas; contas/campanhasLinkedIn; agentes/conversas/açõesSDR. Identificadores e FKs compostas incluem workspace; JSON de fornecedor é payload não confiável, não chave de identidade.

Jobs: queued/running/waiting_external/partial/completed/failed/cancelling/cancelled; reutilizar estados atuais quando já equivalentes. Toda ação remota mantém prepared/sent-or-accepted/uncertain/reconciled; timeout não significa falha definitiva nem autorização de retry cego. Revisão expira e se invalida com alteração de contexto, conteúdo, permissão ou capacidade relevantes.

## Critério de pronto por requisito e pacote

Uma linha só fecha com requisito → rota/estado/controle → serviço/contrato → persistência/autoridade → evento/métrica → teste → evidência visual/funcional. Comparar referência e local no mesmo viewport/estado; evidências pagas/bloqueadas não observadas continuam assim. Sem porcentagem 100% fora de inventário versionado.

Além do caso feliz: dois clientes concorrentes, papel revogado durante I/O, revisão vencida, repetição idempotente, callback fora de ordem, indisponibilidade/resultado parcial, reinício, limite e erro recuperável. Preservar rascunho/seleção ao atualizar. Pilotos usam somente contas/destinatários próprios autorizados e orçamento definido. Nenhum teste de documentação concede autorização para compra/envio externo.

## Sequência, estabilidade do escopo e mudança

O [índice de execução](../plans/2026-10-27-prometeus-cadence-master-plan.md) fixa sequência, dependências, planos por pacote e aceites históricos. Famílias 01–08 preservadas; encerramento 08B, sem 09 definido.06D.1 foi concluído no escopo local/controlado;06D.2 é a próxima implementação. A aprovação da baseline não transforma itens pendentes em entregues.

Alteração de caminho técnico para preservar o requisito entra em decisão registrada: capacidade perdida, evidência, alternativa, impacto em UX/custo/prazo e teste de equivalência. Alterar resultado vendido, direitos/custo recorrente ou fluxo principal requer decisão do operador. Não reabrir o escopo a cada pacote. Parâmetros de implantação/credenciais são entradas operacionais, não requisitos indefinidos.

## Origem e documentação

Referências locais: [roadmap](../plans/2026-10-20-prometeus-cadence-roadmap.md), [escopo aprovado](2026-10-27-prometeus-cadence-scope-audit.md), [inventário de superfícies](../../reverse-engineering/visual-2026-10-25/inventory/routes.md), [limites da auditoria](../../reverse-engineering/visual-2026-10-25/STATUS.md), relatórios de aceite emdocs/validation. Novos desenhos descrevem contratos próprios, não observações adicionais da referência.

Fontes primárias consultadas em 27/10: [LinkedIn Messages](https://learn.microsoft.com/en-us/linkedin/shared/integrations/communications/messages), [BetterAuth 2FA](https://better-auth.com/docs/plugins/2fa), [Apify builds/runs](https://docs.apify.com/actors/running/runs-and-builds), [Stripe subscription updates](https://docs.stripe.com/api/subscriptions/update). Não se afirma suporte da versão instalada apenas por documentação atual: verificar exports/tipos locais antes de implementar. O acervoOSetup não foi encontrado na descoberta de ferramentas desta sessão; nenhuma skill/plugin/Actor novo foi instalado ou selecionado.
