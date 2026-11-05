# 08A.1 — Registro de cobertura e varredura de rotas

Data: 05/11/2026. Estado: **concluído; o aceite integral do 08A continua negado, com 73 de 103 itens** ([revisão](08a1-coverage-sweep-review.md), [plano de execução](../superpowers/plans/2026-11-05-prometeus-cadence-08a1-coverage-sweep-execution.md)).

Para ver o estado atual a qualquer momento:

```bash
node scripts/audit-release-coverage.mjs
```

## O que falta para o aceite

- **Depende de você (6):** LinkedIn (Unipile, jornada e módulo), SDR (piloto, jornada e módulo), CRM e MCP em Claude e ChatGPT, este com URL pública no 08B.
- **Depende do 08A.2 (24):**
  - 5 jornadas clicadas de ponta a ponta;
  - 10 itens transversais: popups, papéis, teclado, zoom, tamanho do texto, falhas de rede, editor de cadência, detalhe de execução, onboarding incompleto e telas com dados;
  - 8 módulos, em que falta conferir falha, recuperação e efeito externo;
  - 1 classificação de estados da referência.

## O que foi medido

**72 rotas, 432 visitas, todas aprovadas**, em 1920, 1440, 768, 390 e 320 px, mais tema escuro real em 390. Cada visita exige:
- o destino final esperado, sem redirecionamento não declarado;
- nenhum erro de página ou de console, nenhuma resposta 5xx e nenhum 4xx de API não declarado;
- nenhuma tela de erro nem tela presa em "carregando";
- nenhum overflow horizontal e nenhum controle fora de alcance;
- todo controle com nome acessível;
- o conteúdo esperado, em contatos e no detalhe do lead.

**Duas contas lado a lado:** cada uma vê os próprios dados, na lista e por id, e nada da outra.

O [relatório](evidence/08a-final-regression/route-sweep.json) guarda o hash do código medido. Se `src` mudar, o auditor passa a ignorá-lo até uma nova varredura. Para repetir, com o servidor local no ar, rode `tests/manual/route-sweep.mjs`.

A varredura só navega: não clica em nada, e o navegador não alcança hosts externos. As contas são `[RE]` e `example.com`, e são removidas ao fim (L-051, resíduo 0).

## Defeitos corrigidos

- **Menu lateral:** com o teste de 7 dias ativo, ainda oferecia "Começar o teste grátis", contrariando a faixa do topo. Agora mostra "Gerenciar meu plano".
- **Aba de relatório inventada:** `/reports/qualquer-coisa` abria normalmente. Agora dá 404.
- **Overflow a 768 px:** relatórios, dashboard, primeiros passos, gerador, contexto e o indicador de passos de automação, que escondia "Agendamento". A 320 px, primeiros passos.
- **Botão "Como funciona":** sem nome acessível quando vira só ícone no celular.
- **Débito do 06C.3:** o teste do resumo semanal agora prova que o fato conta na origem antes de provar que não vaza.

## Validação executada

- **Unitários:** 8/8 do registro e do auditor.
- **Integração focada:** 3/3 de autoridade e isolamento; 15/15 de notificações.
- **Suítes completas:** 448/448 unitários e 658/660 de integração, com os 5 cenários do Stripe pulados; build e tipos com exit 0. As duas falhas são `07A.3b assisted` e `07A.3c approving`, que dependem do horário; a correção está no commit `6c0c618`, na branch `claude/jovial-ardinghelli-03da7a`, ainda sem merge aqui.

## Limites

- **Só navegação:** a varredura prova que cada tela abre sã. Não prova que o fluxo funciona; isso é o 08A.2.
- **Estados não exercitados:**
  - editor de cadência e detalhe de execução, só com id inexistente;
  - conversas e relatórios, sem dados;
  - `/mcp/authorize`, só sem pedido válido;
  - telas de LinkedIn e SDR, com plano Pro, mas sem conta conectada.
- **Referência:** sem comparação visual nesta parte. As correções de quebra de linha a 768 px foram medidas só por overflow.
- **Limite de cadastros:** o limite do app recusou uma das rodadas seguidas. Não foi contornado, e a rodada final esperou a janela passar.
- **Runtime em execução:** roda o código antigo até ser reiniciado.
- **Entrega:** sem push, merge ou deploy.
