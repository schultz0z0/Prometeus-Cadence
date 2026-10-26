# Design gaps and verification queue

Atualização s04,26/10: as filas abaixo registram o baseline histórico. Correções, testes posteriores e diferenças residuais estão consolidados no [REPORT](../REPORT.md). A classificação inicial “Pendente” não deve ser usada como retrato do código atual; também não deve ser convertida automaticamente em aceite100%.

Atualização s05: assistente lateral conversacional versus modal de atalhos é uma diferença visual/funcional confirmada na revisão de evidência retida e código, [EV-267](../evidence/EV-267-assistant-roadmap-gap.json). Donos06A-V/06F. Cadastro, finanças e capacidade comercial receberam06A-P/06A-H/06G no roteiro. Não exigir acesso ao backend privado para implementar/testar os contratos próprios; preservar o rótulo de não observado na referência.

Baseline de25/10/2026, anterior às correções da auditoria. Fontes estáticas indicam diferenças de estrutura/roteamento; elas **não** demonstram pixels locais renderizados. Novas capturas de referência fundamentam a anatomia específica mostrada, não ações persistidas. Atualizar cada item com captura local, viewport, estado e resultado antes de encerrá-lo.

| Gap | Evidência e limite | Correção/verificação requerida | Status |
|---|---|---|---|
| Subpáginas Settings colapsadas | Wrapper passava apenas section[0]; apps/sheets/apollo/funnelsflow/EV-247-meetflow-ref.json mostram headings distintos | Roteamento próprio e tela de cada integração; comparar navegação, largura, formulários/cards e retornos | Baseline identificado; correção/verificação em andamento |
| LinkedIn como um único shell | linkedin-sdr.tsx ignorava section; JSONs linkedin-*-ref trazem famílias distintas |8 seções + nova campanha; preencher nav omitida; workflow campanha→aceite→enriquecimento→cadência→aprovação somente com comportamento real | Baseline identificado; comparação integral pendente |
| Importação apenas modal | Sem wrapper /leads/import no baseline; EV-233-import-ref.json e evidência anterior mostram página | Reproduzir a página/fluxo e manter parser/destino/dedup reais; comparar manual/mapeamento/preview | Pendente de verificação |
| /inbox selecionava canal distinto | Wrapper local sem query caía em WHATSAPP; EV-224-email-inbox-ref.json tem url /inbox e heading E-mail | Compatibilizar URL e canal, preservar outras rotas e thread/reply reais | Baseline identificado; validar correção |
| Dados/MCP/privacy/webhooks genéricos | OtherSettings com EmptyState; duplicates/mcp/privacy/EV-262-webhooks-ref.json mostram anatomias próprias | Reproduzir seções/controles/ajudas sem apresentar recursos ausentes como integrados | Baseline identificado; validar por estado |
| Security incompleta visualmente | EV-257-security-ref.json possui Senha, Autenticador2FA, Dispositivos confiáveis; baseline tinha senha/sessões | Comparar organização, divisores, campos e estados; capacidade ausente deve ter estado verdadeiro | Pendente |
| Notifications com poucas categorias | EV-249-notifications-ref.json divide Dentro/Fora do CadenceFlow; baseline apenas dois toggles | Reproduzir categorias/geometria sem inventar entrega/persistência | Pendente |
| Account/context com estrutura divergente | EV-202-account-ref.json contém Perfil, Contatos da conta, Relatórios por email; EV-217-context-ref.json é evidência específica | Comparar seções/campos/foto/resumos/produtos/accordions/ações e todos retornos | Pendente |
| Onboarding simplificado | EV-219-dashboard-ref.json contém Comece a prospectar e4 blocos; EV-228-first-steps-ref.json e estudo anterior mostram checklist/tours; baseline tinha3 passos dashboard e6 FirstSteps | Checklist14 etapas,4 grupos, progresso derivado, ajudas/esconder; verificar ambos contextos e não inventar conclusão de canais | Pendente |
| Reports performance reutilizada | EV-250-performance-ref.json tem comparativo, detalhamento, etapa, horários; baseline reutilizava overview | Tab própria, filtros e empty/unavailable reais; não fabricar abertura/clique | Pendente |
| Cadência/editor profundo | EV-213-cadence-new-ref.json sem headings não é prova de ausência de UI; EV-214-cadence-settings-ref.json tem5 seções próprias | Captura estabilizada do editor; tabs, canvas, modais e revisão/publicação no mesmo estado | Pendente |
| Autorias/wizards | automation-new/ai e EV-211-cadence-ai-ref.json mostram formulários específicos; wizard anterior não avançou | Todos passos/fontes/condições, validações, cancelar/retomar/revisar; distinguir demo e server | Pendente |
| Inbox conectado não observado | email/EV-264-whatsapp-inbox-ref.json documentam estados limitados; estudo anterior sem conversa conectada | Estados vazios atuais podem ser comparados; conversa/reply/entrega não aceitos sem referência específica | Parcial/desconhecido |
| SDR gate vs operacional | EV-256-sdr-ref.json é oferta/gate observável; não demonstra conversa ativa | Reproduzir gate verdadeiro; não oferecer contratação/ativação de implementação pendente | Parcial |
| Auth/público |35 wrappers locais inventariados; índice anterior sem capturas específicas | Capturar referência autorizada e verificar login/cadastro/senha/email/workspace/convite/token | Não observado |
| Shell e overlays | EV-219-dashboard-ref.json base; captura base não documenta todos popups | Menu/compacto/mobile/breadcrumb/busca/assistente/ajuda/contact/notificação/tema/tamanho/foco | Parcial |
| Comparação inválida por viewport | EV-218-dashboard-before.json:2133×994/DPR~0.9; EV-219-dashboard-ref.json:1920×855/DPR1 | Repetir captura local na mesma escala/viewport antes de medir delta/aceitar | Pendente |

## Protocolo de comparação

1. Declarar rota, estado de dados, plano/permissão, viewport/DPR, scroll e overlay.
2. Ler referência e esperar a tela estabilizar; loading é um estado próprio.
3. Capturar local equivalente. Não comparar métricas de fixtures diferentes como se fossem erros de geometria.
4. Conferir layout, alinhamento, tamanhos, fontes/pesos/line-height, gaps/padding, bordas/radius, cores, iconografia e densidade; depois foco/scroll/teclado/responsive.
5. Registrar desvio, arquivo alterado e verificação pós-correção. Uma linha sem evidência pós-correção permanece pendente.
6. Manter os estados desconhecidos explícitos, os dados/permissões reais, billing aprovado e7 dias/pré-pago/OpenWA.

## Not tested

Não há nesta revisão documental aceite visual local de toda a matriz. Compras/envios/convites/conexões/mutações na referência não realizados. Capturas novas ainda chegando precisam inspeção e pareamento; ausência de heading em JSON não é conclusão de tela vazia.


## Comparação renderizada s02 — 25/10/2026

- Playwright autenticado: 50 rotas de referência em 1920×855 e 390×844, DPR1; 100 capturas mascaradas, sem pageerror e sem overflow horizontal. Referência autenticada pelo operador numa janela isolada. Inventário de 14 menus/overlays nos dois viewports; abrir/cancelar somente. Os arquivos privados estão em output/playwright/visual-audit e não são incluídos no Git nem no handoff da KB.
- Baseline local: 100 visitas, sem pageerror. Overflow observado em /leads/import (2640/1920 e 515/390) e /reports/performance (393/390). Causas identificadas: largura herdada no input file oculto; grupo de botões sem quebra. Correções aplicadas, revalidação pós-build pendente.
- Comparação direta: gerador tinha 3+1 fontes, agora grade de quatro; campanha LinkedIn tinha coluna central, agora formulário+aside; novo editor de cadência usava lista e WhatsApp selecionados, agora começa sem lista e com e-mail; minimapa removido da apresentação inicial. Alterações não ativam envios.
- Novos ajustes: popup de template em editor+preview lateral; modal Criar cadência com 4 cartões; título e ordem dos filtros de contatos; correção de switch vertical em Notificações; limites em painéis por canal; enriquecimento em três indicadores+lista/aside; SDR ganhou apresentação específica. SDR, enriquecimento, fontes não suportadas e integrações pendentes continuam indisponíveis operacionalmente.
- Fonte da diferença de faixa superior: referência sem assinatura ativada; local com Essential ativo. Não forçar trial falso para igualar screenshots. Preservados 7 dias, adicionais pré-pagos e OpenWA gerenciado.
- Ainda NÃO aprovado: matriz inteira pós-correção, todos os passos de fluxo, detalhe de lead, estados de conversa conectada e estados que exigem trial/plano na referência. Os screenshots não tornam essas áreas automaticamente aceitas.
