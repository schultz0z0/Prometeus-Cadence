# Routes and state checklist

Inventário de25/10/2026, levantado por leitura de fontes antes das correções da auditoria. Não prova runtime nem fidelidade. Base: src/app/(app), src/components/shell/navigation.ts, src/modules/settings/navigation.ts e KB ../reaudit-2026-10-24. O mapa enumera superfícies obrigatórias; a coluna Estados é uma **fila de visita/verificação**, não afirmação de que cada estado já foi observado/implementado.

Foram encontrados35 page.tsx:26 no grupo autenticado e9 fora dele. Catchalls, query strings, tabs e overlays expandem muito esta contagem. Nas tabelas, M significa src/modules; C significa src/components. Os wrappers autenticados seguem src/app/(app)/<rota>/page.tsx, salvo catchalls. Referências antigas são nomes de arquivos no diretório ../reaudit-2026-10-24/evidence; capturas novas ficam em evidence/ desta KB. Estes nomes não importam IDs como definições desta KB.

**Aceite de todas as linhas: pendente nesta revisão documental.** Captura de anatomia não aceita fluxo; fluxo de demonstração não aceita integração real.

## Shell e estados transversais

| Superfície | Fonte local | Estados obrigatórios | Referência / limite |
|---|---|---|---|
| Navegação | C:shell/app-shell.tsx; navigation.ts | Grupos abertos/fechados, sidebar compacta, mobile, breadcrumb, rota ativa, limites/gates | EV-219-dashboard-ref.json e referência antiga [linkedin-campaign-new.txt](../../reaudit-2026-10-24/evidence/EV%2D067-linkedin-campaign-new.txt) |
| Topbar e conta | app-shell.tsx; account-controls.tsx | Busca Ctrl+K com vazio/resultados; assistente; ajuda por área; contato; notificações; tema;3 tamanhos texto; workspace/perfil/logout | Confirmar cada overlay; captura base não cobre abertura |
| Trial/plano | app-shell.tsx | Inativo/trial/pago/limite/erro; CTA e destino | Preservar7 dias e billing aprovado |
| Loading/falha global | src/app/(app)/loading.tsx; error.tsx | Página carregando; falha workspace; retry | Sem aceite visual dedicado ainda |
| Componentes compartilhados | C:ui/primitives.tsx; period-selector.tsx; charts/line-chart.tsx | Modal curto/longo/wide; overflow; foco/escape; inputs/select/toggle; notice; badge; vazio; tabela/página | Comparar instâncias por família; não presumir equivalência por compartilhar componente |

## Contatos, prospecção e execuções

| Rota | Fonte principal | Estados/overlays obrigatórios | Referência / observação de inventário |
|---|---|---|---|
| /dashboard | M:dashboard/dashboard.tsx | Base vazia/populada; onboarding; período; KPIs/gráficos; atividade; loading/falha; tours | evidence/EV-219-dashboard-ref.json e EV-221-dashboard-reference.png |
| /contacts?list=… | M:contacts/contacts-table.tsx | Todas/lista; busca/filtros/ordenação; favorito; seleção/bulk; paginação; menus Adicionar/Ações; colunas; manual/import; vazio | Antigos [contacts.txt](../../reaudit-2026-10-24/evidence/EV%2D030-contacts.txt) a [contacts-columns.txt](../../reaudit-2026-10-24/evidence/EV%2D034-contacts-columns.txt) |
| /leads/[id] | M:contacts/lead-detail.tsx; lead-dialog.tsx | Informações/Execuções/Mensagens; editar; qualificado/reprovado; sem resumo; ID ausente | Referência de detalhe não estabelecida pelo inventário anterior; visitar registro real autorizado |
| /leads/import | Sem wrapper dedicado no baseline | Importar arquivo/colar; mapeamento; preview/validação; destino novo/existente; manual; sucesso/erro | Antigos [import.txt](../../reaudit-2026-10-24/evidence/EV%2D052-import.txt), [import-baseline.txt](../../reaudit-2026-10-24/evidence/EV%2D071-import-baseline.txt), [import-manual-form.txt](../../reaudit-2026-10-24/evidence/EV%2D072-import-manual-form.txt); local import-preview.tsx é modal via Contacts |
| /leads/generator?source=MAPS | M:prospecting/generator.tsx; server-generator.tsx | Termo/local; limite/destino; capacidade indisponível; revisão; crédito/limites; job/resultados/falha | Antigos [lead-generator.txt](../../reaudit-2026-10-24/evidence/EV%2D024-lead-generator.txt), [generator-maps.txt](../../reaudit-2026-10-24/evidence/EV%2D025-generator-maps.txt) |
| /leads/generator?source=WEB | Mesmos | Campos específicos WEB; revisão/resultados/falha | Antigo [generator-web.txt](../../reaudit-2026-10-24/evidence/EV%2D026-generator-web.txt) |
| /leads/generator?source=CNPJ | Mesmos; cnpj-filters.tsx | Termo/CNAE/CNPJ; filtros; resultado/dedup; revisão/falha | Fonte local inventariada; estados completos de referência pendentes |
| /leads/generator?source=APOLLO | Mesmos; source-picker.tsx | Conexão/limites; parâmetros; revelar/destino; indisponível | Conferir relação com /settings/apps/apollo; conexão não exercitada |
| /leads/enrich | M:prospecting/enrichment.tsx | Lista/CNPJ/cap; preview; resultado; crédito; indisponibilidade/falha | Antigo [lead-enrichment.txt](../../reaudit-2026-10-24/evidence/EV%2D027-lead-enrichment.txt); preview local não prova enriquecimento real |
| /leads/qualifier | M:prospecting/qualifier.tsx; server-qualifier.tsx | Lista/seleção/filtro; todos módulos/opções; idioma/limite; estimativa/revisão; confirmar; job/resultados/falha | Antigos [lead-qualification.txt](../../reaudit-2026-10-24/evidence/EV%2D028-lead-qualification.txt), [qualification-options.txt](../../reaudit-2026-10-24/evidence/EV%2D029-qualification-options.txt) |
| /executions?automationId=… | M:reports/reports.tsx → prospecting/job-history.tsx | Demo/autenticado; tipo/estado/fonte/automação; loading/vazio/erro; paginação; detalhe | Antigo [executions.txt](../../reaudit-2026-10-24/evidence/EV%2D038-executions.txt); demo e real têm renderizações distintas |
| /executions/[id] | M:prospecting/job-progress.tsx; job-results.tsx | queued/running/cancelling/completed/failed/uncertain; uso/progresso; cancelar; resultados/aplicar/reter; reconciliação; ausente | Todas variantes de job exigem visita; não cobertas só por lista |

## Cadências e templates

| Rota | Fonte principal | Estados/overlays obrigatórios | Referência / observação de inventário |
|---|---|---|---|
| /cadences | M:cadences/cadence-list.tsx | Lista/cards; busca/status/arquivadas; ações; Criar; IA/Modelos/Clonar/Do zero;20 estruturas oferecidas; clone vazio/populado; gate de canal; arquivar/excluir | Antigos [cadences.txt](../../reaudit-2026-10-24/evidence/EV%2D035-cadences.txt), [cadences-settled.txt](../../reaudit-2026-10-24/evidence/EV%2D058-cadences-settled.txt), [cadence-create-dialog.txt](../../reaudit-2026-10-24/evidence/EV%2D059-cadence-create-dialog.txt), [cadence-system-models.txt](../../reaudit-2026-10-24/evidence/EV%2D060-cadence-system-models.txt) |
| /cadences/new | M:cadences/cadence-editor.tsx | Rascunho vazio/sujo/salvo; validações; nome/status; cinco tabs; publicação; revisão; mudança de URL após salvar | Editor existente não foi modificado no estudo anterior; anatomia/ações profundas ainda pendentes |
| /cadences/[id] | Mesmo editor; cadence-settings.tsx | Sequência/Leads/Saúde/Relatório/Configurações; lead vazio/elegível; draft/publicada/pausada; histórico; ID ausente | Abrir cadência concreta e todas tabs |
| /cadences/[id] — sequência | sequence-canvas.tsx; step-editor.tsx; bindings email/WhatsApp | Adicionar/editar/remover etapa; tipos de etapa; zoom; preview por lead; variáveis; espera; canal; erros | Modal de remoção/revisão e preview não aparecem em captura da lista |
| /cadences/[id] — publicação | cadence-publication-v2.tsx; cadence-publication-review.tsx | Seleção remetente; limites; revisão bloqueada/confirmando; versão publicada/histórico; falha | Operações reais preservadas; captura visual não autoriza envio na referência |
| /cadences/new/ai?list=&channel=&product=&job= | cadence-wizard.tsx; server-cadence-wizard.tsx | Brief/contexto/produto; proposta/opções; escolha/revisão; retomada job; criação/falha | Antigo [cadence-ai-form.txt](../../reaudit-2026-10-24/evidence/EV%2D061-cadence-ai-form.txt); geração/criação da referência não exercitadas |
| /cadences/pipeline | M:cadences/pipeline.tsx | Cadência/status/qualificação; colunas vazias/populadas; cartão→lead; scroll | Antigo [cadences-pipeline.txt](../../reaudit-2026-10-24/evidence/EV%2D036-cadences-pipeline.txt) |
| /templates | M:cadences/template-library.tsx | Cards/lista; canal/busca; criar/editar; variáveis/preview; excluir/desfazer; Meta aprovação onde disponível | Antigos [templates.txt](../../reaudit-2026-10-24/evidence/EV%2D037-templates.txt), [templates-before-dialog.txt](../../reaudit-2026-10-24/evidence/EV%2D062-templates-before-dialog.txt), [template-new-form.txt](../../reaudit-2026-10-24/evidence/EV%2D063-template-new-form.txt) |

## Automações

| Rota | Fonte principal | Estados/overlays obrigatórios | Referência / observação de inventário |
|---|---|---|---|
| /automations | M:automations/automation-list.tsx | Filtros/ordem/densidade; vazio/populado; Criar4 modos; modelos/clone; editar; executar; revisão de ativação/pausa; histórico | Antigos [automations.txt](../../reaudit-2026-10-24/evidence/EV%2D039-automations.txt), [automation-cancel-baseline.txt](../../reaudit-2026-10-24/evidence/EV%2D077-automation-cancel-baseline.txt) |
| /automations/new?source=… | M:automations/manual-wizard.tsx; schedule-fields.tsx | Fonte; Termos/localizações; Filtros/deduplicação; Lista destino; Agendamento; validações; voltar/cancelar/criar pausada | Antigos [automation-new.txt](../../reaudit-2026-10-24/evidence/EV%2D064-automation-new.txt), [automation-wizard-source.txt](../../reaudit-2026-10-24/evidence/EV%2D075-automation-wizard-source.txt), [automation-wizard-terms.txt](../../reaudit-2026-10-24/evidence/EV%2D076-automation-wizard-terms.txt); avanço da referência não estabelecido |
| /automations/new — fontes | source-picker.tsx; creation-modes.tsx | MAPS/WEB/CNPJ/APOLLO/QUALIFY/REENGAGE locais; tipo/fonte adicionais observados devem ser reconciliados | Estudo anterior registra7 fontes/tipos; componente local enumera6, portanto não presumir cobertura equivalente |
| /automations/new/ai?job=… | audience-wizard.tsx; server-audience-wizard.tsx | Público/canal; propostas; escolha; revisão/confirmar; job retomado; sucesso→lista/cadência; falha | Não consta captura profunda equivalente no índice anterior |
| /automations — controles | runtime-controls.tsx; runtime-history.tsx | Preparar/revisar ativação; blockers; confirmar; execução; histórico vazio/populado/erro | Estado operacional depende de conta/capacidade reais |

## Mensagens e relatórios

| Rota | Fonte principal | Estados/overlays obrigatórios | Referência / observação de inventário |
|---|---|---|---|
| /inbox | src/app/(app)/inbox/page.tsx; M:messages/inbox.tsx | E-mail esperado pelo link da referência; query channel=email; compatibilidade de rota | Baseline local sem query seleciona WhatsApp; referência antiga [email-inbox.txt](../../reaudit-2026-10-24/evidence/EV%2D041-email-inbox.txt) usa /inbox |
| /messages/email | email-inbox.tsx; email-thread.tsx; email-message.tsx | Sem caixa; loading/vazio; busca/caixa/direção; thread; mensagem antiga; não lida; assinatura; texto/html; falhas | Inbox conectada não exercitada no estudo anterior |
| /messages/email — ações | email-reply.tsx; reconciliation-review.tsx | Composer/revisão; blockers; fila/erro; bloqueio de thread; reconciliação incerta; tracking indisponível | Não inferir entrega/leitura da aceitação |
| /messages/whatsapp | whatsapp-inbox.tsx; whatsapp-reply.tsx; conversation-actions.tsx | Sem conexão; busca/remetente; vazio/loading; conversa/mensagens antigas; text/template; janela Meta/OpenWA; revisão; estado incerto; vínculo/autorização/bloqueio; falha | Antigos [whatsapp-inbox.txt](../../reaudit-2026-10-24/evidence/EV%2D042-whatsapp-inbox.txt), [whatsapp-final-empty.txt](../../reaudit-2026-10-24/evidence/EV%2D079-whatsapp-final-empty.txt); conectado pendente |
| /reports | M:reports/reports.tsx | Overview; período/cadência; métricas/gráficos vazios/populados/loading/falha | Antigo [reports.txt](../../reaudit-2026-10-24/evidence/EV%2D040-reports.txt) |
| /reports/funnel | Mesmo | Funil, filtros, vazio/populado | Antigo [reports-funnel.txt](../../reaudit-2026-10-24/evidence/EV%2D055-reports-funnel.txt) |
| /reports/negocios | Mesmo | CRM desconectado/vazio/conectado; filtros | Antigo [reports-crm.txt](../../reaudit-2026-10-24/evidence/EV%2D056-reports-crm.txt) |
| /reports/performance | Mesmo | Layout/indicadores próprios da tab; filtros; unavailable/loading/falha | Antigo [reports-performance.txt](../../reaudit-2026-10-24/evidence/EV%2D057-reports-performance.txt); baseline local compartilhava ramo de overview |

## Settings

Wrapper src/app/(app)/settings/[[...section]]/page.tsx → M:settings/settings-layout.tsx. No baseline ele passa apenas section[0]; subpáginas de Apps eram descartadas.15 seções no submenu local (8 conta,3 envio,2 dados,2 integrações), incluindo IA adicional local. Ajuda, nav/scroll, breadcrumb e active state também exigem visita.

| Rota | Fonte em M:settings/ | Estados/overlays obrigatórios | Referência nova / limite |
|---|---|---|---|
| /settings; /settings/account | account.tsx | Perfil/foto; nome/cargo/fuso/email; contatos cobrança/WhatsApp; relatórios por email; salvar; permissão/busy/erro | EV-202-account-ref.json; faturamento aprovado preservado |
| /settings/context | context.tsx; context-suggestions.tsx; product-profiles.tsx | Accordions; website/leitura; sugestões; draft/aprovação; produto novo/editar/versão; job/falha | EV-217-context-ref.json |
| /settings/ai | ai.tsx; chatgpt-connection.tsx | Política/modelos; OAuth/retorno; conectado/attention/disconnected; teste revisado; disconnect; loading/erro | Adição local sem captura de contraparte na KB anterior |
| /settings/notifications | settings-layout.tsx::Notifications | Categorias dentro/fora do app; email/WhatsApp; destino; toggles; salvar/erro | EV-249-notifications-ref.json |
| /settings/seats | members.tsx | Convidar/email/role; lista/convite; limite/gate; remover/revogar; loading/erro/sem permissão | EV-248-members-ref.json |
| /settings/security | security.tsx | Senha; autenticador2FA; dispositivos/sessões; ações/validações/erro | EV-257-security-ref.json; não oferecer como real uma capacidade ainda ausente |
| /settings/mcp | settings-layout.tsx::OtherSettings no baseline | Explicação; acesso/gate; pedidos prontos; conectar/permissões conforme estado disponível | EV-245-mcp-ref.json; baseline genérico |
| /settings/plan | plan.tsx; billing-* | Uso/resumo; mensal/anual; catálogo; cobrança/faturas/contato; revisão/falha | Antigos arquivos plan/billing da reaudit; não reabrir decisões aprovadas |
| /settings/email | email-settings.tsx; email-connection-form.tsx; email-diagnostics.tsx | Gmail/SMTP; adicionar/editar/gerenciar; retorno OAuth; prova/teste; diagnóstico; limites; pause/resume; disconnect; vazio/loading/falha | EV-225-email-ref.json; conectado ainda não observado integralmente |
| /settings/whatsapp | whatsapp-settings.tsx; openwa-connection.tsx; openwa-qr.tsx | Meta/número próprio; conectar/gerenciar; QR aguardando/expirado/ready; token/templates; teste/limites; disconnect/falhas | Antigos [whatsapp-settings.txt](../../reaudit-2026-10-24/evidence/EV%2D020-whatsapp-settings.txt), [design-samples.json](../../reaudit-2026-10-24/evidence/EV%2D078-design-samples.json), [whatsapp-public-crop.png](../../reaudit-2026-10-24/evidence/EV%2D080-whatsapp-public-crop.png); preservar OpenWA gerenciado |
| /settings/dispatch-limits | channels.tsx → WhatsApp/Email limitsOnly | Geral/canal/remetente; intervalos; sem remetente; salvar/erro | EV-234-limits-ref.json |
| /settings/dados | OtherSettings no baseline | Grupos duplicados; seleção/prévia; merge; fusões recentes; vazio/erro | EV-222-duplicates-ref.json; baseline apenas EmptyState |
| /settings/privacy | OtherSettings no baseline | Retenção/texto mensagens; política/permissões; revisar/aplicar; vazio/erro | EV-252-privacy-ref.json; baseline apenas EmptyState |
| /settings/apps | integrations.tsx | Cards/status FunnelsFlow/Sheets/Apollo/MeetFlow; Conectar; outro sistema | EV-204-apps-ref.json; baseline sem MeetFlow e modais apenas Notice |
| /settings/apps/google-sheets | Wrapper catchall; integrations.tsx no baseline | Conectar Google; campos/mapeamento/estado/retorno/erro conforme evidência | EV-258-sheets-ref.json; subrota descartada no baseline |
| /settings/apps/apollo | Mesmo | Chave/status; planilha alternativa; parâmetros/erro | EV-203-apollo-ref.json; subrota descartada no baseline |
| /settings/apps/funnelsflow | Mesmo | Nova conta/Conexão; mapeamento/estado/erro | EV-230-funnelsflow-ref.json; subrota descartada no baseline |
| /settings/apps/meetflow | Mesmo | Conteúdo/plano/CTA; acesso; sem tornar oferta pendente contratável | EV-247-meetflow-ref.json; subrota descartada no baseline |
| /settings/webhooks | OtherSettings no baseline | Lista; criar/modal; eventos/URL; editar/remover; feedback/erro | EV-262-webhooks-ref.json + antigo [webhook-form.txt](../../reaudit-2026-10-24/evidence/EV%2D074-webhook-form.txt); baseline EmptyState |

## LinkedIn e SDR

Wrapper src/app/(app)/linkedin/[[...section]]/page.tsx → M:settings/linkedin-sdr.tsx. No baseline o wrapper descarta segmentos após o primeiro e o componente não usa section. As URLs abaixo eram uma única introdução/modal de preview, apesar de corresponderem a famílias distintas na referência. Capturas novas devem ser lidas individualmente; uma delas não aceita as demais.

| Rota | Estados obrigatórios / referência anterior | Navegação baseline |
|---|---|---|
| /linkedin; /linkedin/dashboard | Resumo/KPIs; conta conectada/gate; vazio/loading/falha; antigo [linkedin-dashboard.txt](../../reaudit-2026-10-24/evidence/EV%2D044-linkedin-dashboard.txt) | Visão geral presente |
| /linkedin/campaigns | Lista/filtros/status; nova; draft/ativação/pausa; antigo [linkedin-campaigns.txt](../../reaudit-2026-10-24/evidence/EV%2D045-linkedin-campaigns.txt) | Presente |
| /linkedin/campaigns/new | Nome; filtros vs post; IA/URL; chips cargo/local/setor; graus; explorar; decisor; provas/variáveis/nota; ritmo/aquecimento; listas aceites/não aceites; enriquecimento; rascunho; antigo [linkedin-campaign-new.txt](../../reaudit-2026-10-24/evidence/EV%2D067-linkedin-campaign-new.txt) | Segmento new descartado |
| /linkedin/people | Lista/filtros; pessoa/detalhe; seleção/ação; antigo [linkedin-people.txt](../../reaudit-2026-10-24/evidence/EV%2D046-linkedin-people.txt) | Presente |
| /linkedin/pipeline | Etapas/contagens/cards; filtros; pessoa; antigo [linkedin-pipeline.txt](../../reaudit-2026-10-24/evidence/EV%2D047-linkedin-pipeline.txt) | Ausente |
| /linkedin/enrichment | Lista/origem/módulos/créditos; revisão/resultado/falha; antigo [linkedin-enrichment.txt](../../reaudit-2026-10-24/evidence/EV%2D048-linkedin-enrichment.txt) | Ausente |
| /linkedin/approvals | Pendentes/aprovadas; review por pessoa/mensagem; gate; antigo [linkedin-approvals.txt](../../reaudit-2026-10-24/evidence/EV%2D049-linkedin-approvals.txt) | Presente |
| /linkedin/cadences | Lista/criar/editor; aceite→cadência; antigo [linkedin-cadences.txt](../../reaudit-2026-10-24/evidence/EV%2D050-linkedin-cadences.txt) | Ausente |
| /linkedin/templates?… | Filtro/tipo; criar/editar/variáveis/preview; antigo [linkedin-templates.txt](../../reaudit-2026-10-24/evidence/EV%2D051-linkedin-templates.txt) | Ausente |
| /sdr | Gate Pro; onboarding/configuração; canais/contexto; conversas/escalada/controle humano somente com evidência; antigo [sdr.txt](../../reaudit-2026-10-24/evidence/EV%2D043-sdr.txt) | Link presente; UI operacional não exercitada |

## Auth, onboarding e rotas públicas

| Rota / wrapper sob src/app/ | Fonte principal | Estados obrigatórios | Cobertura da referência |
|---|---|---|---|
| / — page.tsx | redirect /dashboard | Autenticado/anônimo; destino correto | Sem captura dedicada |
| /login — login/page.tsx | M:auth/form.tsx | Login; Google ligado/desligado; busy/erro; não verificado; sessão→redirect | Não consta no índice anterior |
| /register — register/page.tsx | Mesmo | Cadastro/validações; Google; sucesso/erro | Não consta no índice anterior |
| /forgot-password — forgot-password/page.tsx | Mesmo | Enviar/busy/sucesso/falha | Não consta no índice anterior |
| /reset-password?token=… — reset-password/page.tsx | Mesmo | Token válido/ausente/expirado; nova senha; sucesso/erro | Não consta no índice anterior |
| /verify-email — verify-email/page.tsx | Mesmo | Pendente; reenviar; sucesso/falha | Não consta no índice anterior |
| /onboarding/workspace — onboarding/workspace/page.tsx | M:auth/workspace.tsx | Criar; escolher existente/trocar; busy/erro | Não consta no índice anterior |
| /accept-invitation?id=… — accept-invitation/page.tsx | Mesmo | Válido/inválido/expirado; email/usuário; aceitar/busy/erro | Não consta no índice anterior |
| /unsubscribe/[token] — unsubscribe/[token]/page.tsx | M:messages/unsubscribe-form.tsx | Confirmação; sucesso; token inválido/repetido; busy/erro | Não consta no índice anterior |
| /first-steps — (app)/first-steps/page.tsx | C:onboarding/tour.tsx | Checklist completo/incompleto; ações; tours por área; retorno | Antigo [first-steps.txt](../../reaudit-2026-10-24/evidence/EV%2D069-first-steps.txt):14 etapas-base/próximo nível/tours; baseline local6 etapas |
| /start-trial | Sem wrapper dedicado no baseline | CTA/destino/revisão/retorno; política7 dias preservada | Link na referência anterior; local manda ao plano |

## Limites do mapa e protocolo de atualização

- APIs/callbacks sem UI não são telas independentes: auth, billing, mail OAuth, AI OAuth e unsubscribe possuem rotas de servidor. Seus retornos/erros visíveis precisam ser conferidos na interface que os apresenta.
- URLs dinâmicas exigem IDs reais autorizados do ambiente local; não usar IDs da referência nem inventar dados operacionais.
- Marcar um estado como verificado somente após ler sua referência, registrar captura local equivalente e resultado. Acrescentar evidência, viewport, estado de dados/entitlement e data; preservar os pendentes.
- O estudo anterior diz expressamente que conectados/pagos/transações, responsividade e teclado completos não foram aceitos. Não elevar cobertura por inferência.
