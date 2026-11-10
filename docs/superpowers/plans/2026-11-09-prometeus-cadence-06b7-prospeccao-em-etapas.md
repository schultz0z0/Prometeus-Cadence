# 06B.7 — Prospecção em etapas

> **Execução do plano**
> Use `superpowers:executing-plans` ou `superpowers:subagent-driven-development`. Cada tarefa passa por RED, GREEN e revisão independente somente leitura. O aceite depende dos resultados medidos.

**Objetivo**

Alinhar a entrada da prospecção ao CadenceFlow. Gerar em uma fonte, salvar numa lista e escolher quando qualificar ou enriquecer. Retirar a jornada integrada do fluxo padrão e da sequência obrigatória de lançamento.

**Arquitetura**

Preservar as listas, os jobs por módulo, os recibos, as reservas e a autoridade por workspace. Reutilizar o coletor Scrapling com Playwright e Chromium para abrir sites. A Apify continua nas buscas de Maps, resultados web e Base CNPJ. O Apollo usa a conexão própria do workspace.

**Base de decisão**

O operador aprovou o fluxo em etapas em 09/11/2026 após a rechecagem com RES no Chrome e análise REA do acervo local. A referência oferece as quatro fontes no Gerador, módulos no Qualificador e Enriquecer decisores como tela separada. A elegibilidade observada para decisores exige empresa qualificada, CNPJ e ausência de enriquecimento anterior. A investigação de CNPJ ausente, com evidência antes de buscar decisores, é uma capacidade própria do Prometeus. O piloto anterior avaliou dez empresas, perdeu nove no cruzamento com o Maps e encerrou sem inserções. [Referência observada](../../reverse-engineering/visual-2026-10-25/evidence/EV-321-lead-flow-reference.md) · [Piloto](../../validation/06b6e-prospecting-live-pilot.md)

## 1. Gerador por fonte e preservação do histórico

**Arquivos de partida** `src/modules/prospecting/server-generator.tsx`, `source-picker.tsx`, `src/modules/automations/server-audience-wizard.tsx`, `src/server/research/journey-http.ts`, `src/server/prospecting/service.ts`, `tests/integration/06b5-prospecting-journey.test.ts`, `tests/integration/prospecting-pipeline.test.ts` e `tests/manual/full-journeys.mjs`.

- [ ] Cobrir em RED a presença das quatro fontes e a ausência do acionador Prospecção completa no fluxo padrão. Incluir o acionador de `JourneyStart` no assistente de público das automações. Inventariar entradas no assistente e nas ajudas. Exercitar o histórico com job legado e tentativa direta de criar jornada integrada por um workspace comum. Garantir que o bloqueio deixa zero efeitos.
- [ ] Retirar a entrada padrão e usar uma guarda de servidor para novas jornadas integradas. Preservar leitura, estados, cancelamento e reconciliação autorizada dos registros históricos. Tratar uma retomada que abriria trabalho novo como uma ação separada da leitura do histórico. Manter os jobs avulsos e a investigação de empresa pelos pontos que já existem.
- [ ] Validar criação ou reutilização de lista, filtros por fonte, deduplicação e carregamento, falha, parcial e sucesso. Usar cenários com Maps sem CNPJ, Base CNPJ sem site, Web com resultado de empresa verificado e Apollo sem conexão. A revisão distingue fonte indisponível de ausência de resultados. Identidade e filtros próprios da fonte governam o aceite.
- [ ] Conferir que o consumo comercial acompanha somente as inserções elegíveis. Preservar franquias diárias e mensais, renovação mensal sem acumular, créditos adicionais com teto separado e escolha explícita do saldo. Rodar a integração de prospecção e a jornada `pack` atualizada.

## 2. Qualificador sobre listas existentes

**Arquivos de partida** `src/modules/prospecting/server-qualifier.tsx`, `qualification-controls.tsx`, `qualification-review.tsx`, `src/server/prospecting/qualification.ts` e `tests/integration/prospecting-pipeline.test.ts`.

- [ ] Cobrir em RED uma lista com perfis completos, empresas sem site ou CNPJ, fonte indisponível e evidência ambígua. Rodar a suíte focada com adaptadores controlados e verificar que cada asserção falha pelo motivo esperado.
- [ ] Reusar os módulos de descoberta, navegação, extração e consulta cadastral. Aplicar somente módulos selecionados e seus filtros. Exibir o motivo quando um módulo fica sem evidência e manter proposta ou abstenção para revisão. A ausência de site por si só permite que os outros módulos aplicáveis rodem. Tratar opções explícitas de filtro como escolha do operador.
- [ ] Testar evidência atribuída à empresa, domínio institucional em vez de um buscador ou diretório, recuperação após falha, revisão e aplicação por papel. Validar que sugestões geradas ficam separadas da aprovação humana e do envio. Rodar a suíte focada em GREEN.

## 3. Enriquecedor de decisores

**Arquivos de partida** `src/modules/prospecting/enrichment.tsx`, `src/server/research/people.ts`, `src/server/prospecting/enrichment.ts`, `src/server/prospecting/enrichment-context.ts`, `tests/integration/06b4-company-people.test.ts` e `tests/integration/prospecting-pipeline.test.ts`. O lote clássico usa `enrichment-context.ts`. O modo `companyPeople` investiga identidade no serviço `people.ts`.

- [ ] Cobrir em RED revisão e confirmação do lote padrão, elegibilidade, qualificação, CNPJ confirmado, homônimo, contato pessoal sem atribuição, pessoa já enriquecida, repetição e teto comercial. Incluir entrada separada para investigar empresa sem CNPJ, com fonte e resultado revisável.
- [ ] Seguir a regra observada para o lote padrão de decisores. Encaminhar a confirmação de identidade de uma empresa sem CNPJ para a investigação própria do Prometeus. Buscar decisor com vínculo verificável e registrar qual contato de fato pertence a ele. Exibir dados ausentes sem inventar celular ou WhatsApp. Manter lista de pessoas, revisão, consumo auditável e isolamento.
- [ ] Confirmar GREEN, incluindo orçamento por lote e restituição de reservas em resultados vazios, parciais ou cancelados conforme o contrato vigente. Comparar a prévia, os estados sem elegíveis e a tela de resultados com a referência observável.

## 4. Encerramento da implementação e transferência para homologação

- [ ] Comparar Gerador, Qualificador, Enriquecedor e transições de lista no mesmo estado em 1920×855 e 390×844, com uma prova adicional em 320 px. Verificar teclado, papéis, modais, retorno de foco, falha de rede, estado vazio e histórico. Usar a referência apenas em leitura e dados locais `[RE]` em `example.com` com limpeza por ID e resíduo zero.
- [ ] Rodar focados, unitários, integração completa, build, tipos e `git diff --check`. Medir a cobertura final após as edições. Atualizar relatório, revisão, evidência, manifesto e matriz com o hash atual. Manter os aceites históricos com suas limitações.
- [ ] Liberar a homologação real do núcleo pelo 06B.6e e 06IA-H com um roteiro separado por operação. Medir volume pedido, encontrados, novos inseridos, descartes, campos com fonte, custo, tempo e reservas finais. Qualificar um lead da lista com site e um com dados incompletos. Enriquecer uma empresa elegível e observar um caso sem contato atribuível. Capturar o uso de Chromium no worker contínuo por um módulo avulso. Cada rodada paga exige escopo e limite autorizados. O piloto integrado com CNPJ primeiro permanece como histórico do 06B.6c.

**Entradas para o piloto.** Conferir saúde e versão do gateway, builds de Maps, Web e CNPJ, saldo e autorização da Apify e disponibilidade da rota central de IA já configurada. Reservar um workspace e uma lista de homologação. Usar uma chave Apollo com permissão de pesquisa somente na rodada dessa fonte. Registrar origem, orçamento e operador antes de iniciar cada rodada.

## Limites de execução

- Ler `AGENTS.md` e o guia aplicável em `node_modules/next/dist/docs/` antes de escrever código. Usar banco efêmero para testes que criam jobs. Nunca semear jobs ativos no banco compartilhado, ativar cadência ou canal em QA, enviar mensagens ou escrever no CadenceFlow.
- Preservar trial de sete dias, créditos adicionais pré-pagos, OpenWA gerenciado e administração central de Apify e IA. Manter o Website Content Crawler da Apify fora de novas leituras de site.
- Push, merge, deploy, escrita no Stripe e ações externas seguem as autorizações específicas do operador.

## Revisão do planejamento

A revisão independente apontou o acionador da jornada no assistente de automações, a necessidade de manter a investigação de CNPJ separada do lote clássico de decisores e a dependência de HTTPS para completar os casos externos do 08A. O plano agora cobre as duas entradas da jornada integrada e separa homologação HTTPS restrita de ativação pública. O 08B exige evidência operacional e de IA por módulo antes da ativação.
