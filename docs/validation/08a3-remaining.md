# 08A.3 — Pendências locais e comparação visual

Data: 05/11/2026. Estado: **concluído no escopo abaixo; o aceite integral do 08A continua negado, com 103 de 126 itens** ([revisão](08a3-remaining-review.md), [plano](../superpowers/plans/2026-11-05-prometeus-cadence-08a3-remaining-execution.md)). Não é aceite de paridade 100% nem de produção pública.

Para ver o estado atual, rode `node scripts/audit-release-coverage.mjs`.

## O que rodou de verdade

Dez jornadas novas, somadas às 11 do 08A.2. Erros de página e de API fora da lista declarada reprovam a jornada.

| Registro | O que prova | O que não prova |
|---|---|---|
| Prospecção local: adicionar, importar e criar cadência | Lead pelo formulário, importação colada e cadência criada pela tela | Não confere o conteúdo da pré-visualização |
| Apagar texto antigo: ligar a política com confirmação digitada | O switch, a confirmação `APAGAR` e o estado salvo após recarregar | A exclusão em si, que tem [prova de integração](06e2-data-lifecycle.md) com PostgreSQL real |
| Cadência: editar e salvar | Edição salva e relida | |
| Onboarding: concluir complemento | Conta incompleta termina o cadastro | |
| Execução: falha e parcial reais, em andamento simulado | Falha e parcial vêm do banco; "em andamento" é resposta simulada, porque um job `running` real poderia ser pego por um worker | Não acompanha um job em andamento de verdade |
| Operador recusado e administrador aceito em 4 chamadas de API | Mesma chamada: 403 para o operador e aceita para quem tem o papel | Os papéis nas telas |
| Teclado em 8 telas | Tab com foco visível e foco devolvido por busca e assistente | As outras 64 rotas |
| Rede em 1 formulário e 2 leituras, com foco após erro | Chave de API, contatos e relatórios em 503: aviso, rascunho, foco e recuperação | Os demais formulários |
| 11 popups de módulo abertos e fechados | Abrir, sem overflow, e fechar com Escape | Os demais usos do `Modal`, item pendente |
| Funil conta os contatos reais | O cartão "Total Leads" mostra 7 com 7 contatos; 320 px sem overflow | Relatórios de envio, que exigem mensagens registradas |

**Varredura:** 72 rotas, 576 visitas, todas aprovadas, medidas depois da última edição, com as 21 jornadas (21/21, resíduo 0).

## Comparação visual com a referência

Feita no mesmo viewport (1920×855 e 390×844) com as capturas já guardadas da referência, sem acessar o CadenceFlow. A conta local está vazia e a da referência tem dados, então diferença de dados não conta. Logo, marca e teste de 7 dias são divergências escolhidas. Folhas lado a lado em [evidence/08a-final-regression/visual](evidence/08a-final-regression/visual/).

**Corrigido nesta fase:**

- **Mensagens:** `/inbox` agora abre o grupo e marca E-mail; o breadcrumb dizia "Mensagens › Mensagens".
- **Caixas sem canal:** WhatsApp e e-mail levam à conexão, em vez de uma lista vazia. Só donos e administradores veem o botão.
- **Guia:** pipeline e relatórios abrem a Central de Ajuda.
- **Gerador a 390 px:** o ícone cobria o nome da fonte, e o texto ficava espremido. Era um defeito de layout.
- **Primeiros passos:** título correto no celular e percentual em destaque.
- **Checklist:** em cada grupo, só o próximo passo tem o botão principal.
- **Relatórios vazios:** painel com fundo, como na referência.

**Veredito por área:**

| Área | Veredito | Diferença aberta |
|---|---|---|
| Execuções | **Diferente** | A referência é "O diário das suas cadências": Sucesso, Erro, Pulado e Em andamento, com busca, filtros e tabela por mensagem. A local lista jobs: buscas, qualificações e análises. Exige leitura nova |
| Seletores em todo o app | **Diferente** | A referência usa dropdown próprio; aqui são `<select>` nativos (pipeline, cadências, relatórios, conta, membros) |
| Primeiros passos | Parcial | Falta o cartão lateral "Prefere que a gente monte?". É oferta de serviço que não existe aqui, então não entra sem decisão sua |
| Dashboard | Parcial | Texto e selos de desconto da referência não foram copiados, porque não há esse desconto; ilustrações próprias |
| Cadências | Parcial | Falta "Filtros" e o cartão "Hoje" no celular; a lista local tem outros contadores |
| Nova cadência | Parcial | "Sem conteúdo" e o estilo do chip "Saída" |
| Nova automação | Parcial | Voltar acima do título; ícones coloridos nas fontes |
| Gerador e qualificador | Parcial | Ícones coloridos das fontes |
| Importar leads | Parcial | Passos e texto do aviso |
| Enriquecer | Divergência registrada | "Histórico" no lugar de "Comprar créditos" ([06-qualification-enrichment](06-qualification-enrichment.md)) |
| Caixa de e-mail | Parcial | Aviso de IMAP e estado vazio mais rico |
| Membros | Parcial | "1 de 3 assentos" no lugar da contagem de membros; seletor de papel a mais |
| Conta | Parcial | Enviar foto indisponível |
| CRM e apps | Parcial | FunnelsFlow sem o convite da referência: não há contrato oficial |
| Webhooks e API | Parcial | A API de leitura aparece aqui e não na captura da referência |
| Agente SDR | Divergência registrada | O texto não promete marcar reunião enquanto o piloto não ocorrer |
| Plano | Divergência registrada | Teste de 7 dias e créditos adicionais |
| Relatórios, funil, LinkedIn, WhatsApp, Contatos duplicados, Contas de e-mail | Próximo | Só texto e medidas pequenas |

O item "visual: comparação com a referência por área" fica **pendente**: há diferenças abertas, e o aceite é seu.

## Os 8 módulos conferidos

Nenhum foi aprovado. A regra é a mesma para todos: efeito externo não homologado vira bloqueio, ainda que o serviço local esteja provado.

| Módulo | Provado localmente | O que bloqueia |
|---|---|---|
| Pesquisa e enriquecimento | Falha, parcial e retomada | A prova real de 21/10 cobre um lead, pela rota antiga. Falta a rota central atual, com custo autorizado |
| Cadências e automações | Ciclo integrado, com transporte substituído | Envio real por cadência com canal próprio |
| E-mail e WhatsApp | Gmail com ida e volta reais | Na saída de WhatsApp, a Meta recusou a entrega (130497) e o OpenWA não teve piloto |
| Relatórios e notificações | Relatórios reconciliados | Aviso externo por e-mail, desligado neste ambiente |
| Assistente, busca e ajuda | Busca, ajuda e fallback | A rota central respondeu limite de assinatura; nenhuma resposta real da IA foi observada |
| API e webhooks | API e fila | Entrega a um receptor público |
| Google Agenda e Sheets | Caminhos com Google simulado | Cliente OAuth e conta de teste |
| Identidade, membros e privacidade | 2FA, revogação, conflito, desfazer fusão | E-mail por SMTP público e login Google |

## O que falta para o aceite

Veja a lista completa no auditor.

- **Depende de você:** tudo o que está bloqueado acima, mais LinkedIn, SDR, CRM e MCP em cliente real, e o aceite visual.
- **Pendente e local:**
  - diário de execuções e seletores próprios;
  - demais popups e teclado nas demais telas;
  - papéis nas telas, nas demais áreas;
  - rede nos demais formulários;
  - relatórios com envios.

## Segurança

O navegador não alcança hosts externos e as contas não têm canal, então nada foi enviado. Sem pesquisa ou IA paga e sem confirmação no Stripe. Os jobs semeados são só terminais, que os workers não pegam. Contas `[RE]` removidas por id: resíduo 0. Nenhum acesso ao CadenceFlow.

## Validação executada

- **Medição final, depois da última edição:** 21/21 jornadas e 576/576 visitas, resíduo 0.
- **Suítes completas:** 457/457 unitários e 658/660 de integração, com os 5 cenários do Stripe pulados; build e tipos com exit 0; `git diff --check` limpo.
- **As duas falhas:** `07A.3b assisted` e `07A.3c approving` dependem do horário. A correção está no commit `6c0c618` do branch `claude/jovial-ardinghelli-03da7a`, que não foi unido a este, porque a decisão é sua.
- **Auditor:** "Aceite integral: não (103/126)", com 17 bloqueados, 6 pendentes e 4 com referência desconhecida, mas com prova local.
- **`check-kb`:** só os 4 erros que já existiam em `clone/barriers.md`.

## Limites

- **Aviso e leitor de tela:** com um diálogo aberto, o aviso fica visível, mas o resto da página é inerte, então um leitor de tela pode não anunciá-lo.
- **Troca de estado vazio:** a caixa de WhatsApp sem canal mostra o layout completo por um instante antes do estado vazio.
- **Testes das correções visuais:** [08a3-visual-fixes](../../tests/08a3-visual-fixes.test.ts) confere navegação e, no resto, o texto do código; o comportamento das caixas e do guia está em `module-popups`.
- **Comparação visual:** só a tela inicial de cada rota, sem popups nem rolagem, com conta vazia.
- **Runtime em execução:** roda o código antigo até ser reiniciado.
- **Entrega:** sem push, merge ou deploy.
