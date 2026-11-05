# 08A.2 — Jornadas clicadas e itens transversais

Data: 05/11/2026. Estado: **concluído no escopo abaixo; o aceite integral do 08A continua negado, com 92 de 119 itens** ([revisão](08a2-journeys-review.md), [plano de execução](../superpowers/plans/2026-11-05-prometeus-cadence-08a2-journeys-execution.md)).

Para ver o estado atual, rode `node scripts/audit-release-coverage.mjs`.

## Defeitos que as jornadas acharam

- **Erro invisível em todo diálogo:** a mensagem de falha, e também a de sucesso, ficava atrás do desfoque do diálogo. Com o servidor em 503, a pessoa clicava em salvar e nada parecia acontecer. Agora o aviso fica por cima.
- **Foco perdido em todo diálogo:** ao fechar, o foco ia para o início da página, atrapalhando quem usa teclado. Agora volta a quem abriu.
- **Overflow:** filtro de relatórios a 960 px (zoom 200%) e botões de formulário a 320 px com texto grande.

## O que rodou de verdade

**11 jornadas, 39 passos**, com erros de página e de API reprovando a jornada, salvo os declarados:

| Registro | O que prova |
|---|---|
| Cadastro → teste → revisão de assinatura | Formulário real, verificação, workspace, ativar teste, revisão anual sem confirmar |
| Pacote: revisão e cupom recusado | Preço do servidor; recusa na tela sem perder o rascunho; nada criado |
| Fundir, desfazer e exportar | Duplicados, desfazer, CSV com o contato; apagar texto só até a confirmação digitada |
| API: chave, escopo e revogação | Chave real, 403 fora do escopo, chave falsa 401, revogar corta o acesso |
| Popups do menu e da barra | Busca, ajuda, como funciona, notificações, novo lead e menu a 320 px, com Escape |
| Operador recusado em cobrança | Tela travada com o motivo e API 403 |
| Foco em Adicionar e Ajuda | Foco não vaza para a página atrás e volta a quem abriu; Tab sempre visível |
| 503, offline e lentidão no formulário de lead | Mensagem visível, rascunho mantido, nova tentativa salva, sem salvar duas vezes |
| Cadência: abrir existente | Rascunho com o passo, inclusive a 320 px |
| Execução: detalhe concluído | Detalhe e lista |
| Onboarding: bloqueia sem aceite | Cadastro incompleto vai ao complemento e não avança |

**Varredura:** 72 rotas, 576 visitas, todas aprovadas, agora também com zoom 200% e o maior texto a 320 px.

## O que veio de outro relatório

Sem confirmação no Stripe nesta rodada. Pagamento, renovação e cancelamento reais estão nos relatórios do [06A-H](06-billing-homologation.md) e do [06G](06g-stripe-homologation.md).

## O que falta para o aceite

Veja a lista completa no auditor. Em resumo:

- **Depende de você (8):** pesquisa e IA reais, LinkedIn e SDR (jornada e módulo), CRM e MCP em cliente real.
- **Pendente para um 08A.3:**
  - prospecção local, apagar texto, editar cadência, concluir onboarding;
  - falha, parcial e em andamento nas execuções;
  - popups por módulo (`Modal` aparece em 59 arquivos), teclado nas demais telas, papel de administrador;
  - rede nos demais formulários e foco após erro;
  - conversas e relatórios com dados;
  - conferência de 8 módulos;
  - **comparação visual com a referência**, exigida pelo `AGENTS.md` e não feita no 08A.

## Segurança

O navegador não alcança hosts externos e as contas não têm canal, então nada foi enviado. Sem pesquisa ou IA paga e sem escrita no Stripe. As fixtures são rascunho de cadência e execução já concluída, que os workers não pegam. As contas são removidas por id ao fim, com resíduo 0 (L-052).

## Validação executada

- **Unitários:** 13/13 do registro e do auditor.
- **Suítes completas:** 453/453 unitários e 658/660 de integração, com os 5 cenários do Stripe pulados; build e tipos com exit 0. As duas falhas são `07A.3b assisted` e `07A.3c approving`, que dependem do horário; a correção está no commit `6c0c618`, na branch `claude/jovial-ardinghelli-03da7a`, ainda sem merge aqui.

## Limites

- **Aviso e leitor de tela:** com um diálogo aberto, o aviso fica visível, mas o resto da página é inerte, então um leitor de tela pode não anunciá-lo. Está coberto em "foco após erro", pendente.
- **Fixtures:** cadência e execução são semeadas no banco; o teste abre a tela, não cria pelo fluxo.
- **Zoom:** mede só o carregamento das páginas.
- **Isolamento:** provado para leads.
- **Runtime em execução:** roda o código antigo até ser reiniciado.
- **Entrega:** sem push, merge ou deploy.
