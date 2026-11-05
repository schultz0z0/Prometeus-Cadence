# 08A.2 — Jornadas clicadas e itens transversais

05/11/2026. Segunda parte do [08A](2026-10-27-prometeus-cadence-08a-final-regression.md), depois do [08A.1](2026-11-05-prometeus-cadence-08a1-coverage-sweep-execution.md).

## Limites de segurança

As jornadas clicam de verdade em ambiente local, com o runtime no ar. Portanto:
- **Nada sai da máquina pelo navegador:** hosts externos ficam bloqueados.
- **Sem envio:** as contas não têm canal conectado, e nenhum "Aprovar e enviar" é clicado.
- **Sem custo de fornecedor:** pesquisa real e IA real não são disparadas, porque consomem Apify e LLM centrais sem autorização para esta rodada.
- **Sem escrita no Stripe:** revisões são abertas, e confirmações não. O pagamento real já está provado na [homologação do 06G](../../validation/06g-stripe-homologation.md), e o relatório diz qual prova vem de onde.

Jornada que para antes do efeito externo não vira aprovação integral por isso. Onde a parte que falta não tem prova em outro lugar, o item fica bloqueado e diz por quê.

## Regras do registro

- **Item com `run`:** é decidido só pelo relatório `journeys.json`, medido sobre o código atual. Status digitado é ignorado.
- **Relatório antigo ou de outro código:** não conta.
- **Zoom 200% e tamanho do texto:** entram na varredura como viewports próprios de todas as rotas.

## Jornadas

| Jornada | O que clica | Onde para |
|---|---|---|
| Cadastro | formulário, verificação, workspace, ativar teste, revisar assinatura | antes de confirmar; pagamento na homologação |
| Prospecção | adicionar lead, importar por lista, criar cadência, abrir o editor | antes de pesquisa e IA reais e de enviar |
| Pacote, renovação, cancelamento | revisões de pacote e cancelamento | antes de confirmar; efeito real na homologação |
| Dados | fundir duplicados, desfazer, exportar | apagar texto só até a confirmação |
| API | criar chave, chamar a API, revogar e ver a recusa | MCP real no 08B |

## Transversais

Popups e menus globais (abre, Escape fecha, foco volta), teclado, zoom, texto, atraso, offline e 503 sem perder rascunho, papéis e cadastro incompleto.

## Testes (RED primeiro)

- **Unitários:** item com `run` não aprova sem relatório, com relatório antigo ou por status digitado.
- **Manual:** `tests/manual/full-journeys.mjs`, com cada passo registrado e captura em caso de falha.
