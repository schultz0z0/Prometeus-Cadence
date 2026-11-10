# 06B.7 — Prospecção em etapas

**Estado em 10/11/2026: implementado e verificado localmente.** A homologação real por módulo (06B.6e e 06IA-H) e a comparação com a referência ao vivo continuam pendentes. [Plano](../superpowers/plans/2026-11-09-prometeus-cadence-06b7-prospeccao-em-etapas.md) · [Revisão independente](06b7-prospeccao-em-etapas-review.md)

## O que mudou

- **Jornada integrada arquivada.** `POST /api/prospecting/journeys` e as ações `resume`, `prepare-cadence` e `confirm-cadence` respondem 409 `LEGACY_JOURNEY_ARCHIVED`, para qualquer workspace e papel, sem criar job nem lista. Leitura do histórico e encerramento (`cancel`) continuam. Uma ação desconhecida em `/journeys/{id}/{x}` passou de 404 para 409.
- **Worker e reconciliação.** Decisão do operador em 10/11/2026: uma jornada antiga em andamento termina a etapa atual e para em `blocked` com `LEGACY_JOURNEY_ARCHIVED`, sem enfileirar pesquisa, decisores ou qualificação. A reconciliação de uma chamada incerta acerta a operação e cancela o job, sem reenfileirar a descoberta. Os leads já encontrados continuam na lista. O banco local tinha 2 jornadas bloqueadas, 2 em revisão e nenhuma em andamento.
- **Entradas removidas.** O Gerador e o assistente de público das Automações não oferecem mais a Prospecção completa. A tela de andamento de jornadas antigas mostra aviso de arquivada, e "Pausar jornada" virou "Encerrar jornada", com aviso de que não há retomada.
- **Gerador por fonte.** Sem mudança de código: Maps, Busca na web e Base CNPJ já salvavam leads com os dados que a fonte entrega. Apollo sem conexão aparece como bloqueio na revisão.
- **Qualificador.** Sem mudança de código: cada módulo selecionado roda de forma independente e registra o motivo quando se abstém (`NO_CNPJ`, `NO_EVIDENCE`).
- **Enriquecedor.** Decisão do operador em 10/11/2026: age em qualquer lead com CNPJ válido, qualificado ou não. Lead sem CNPJ mostra um link para o Qualificador. A tela usa só o lote clássico por CNPJ; a investigação `companyPeople` ficou sem entrada na tela, com servidor e testes preservados. Isso diverge da referência, que exige empresa qualificada, e está registrado no `AGENTS.md`.
- **Banco.** A migração `114-enrichment-cnpj-only.sql` retira a exigência de lead qualificado de três funções: reserva (`billing_guard_job`), cobrança (`charge_enrichment_resolution`) e aplicação (`apply_enrichment`). Sem ela, um lead pendente com CNPJ passava na revisão e falhava na execução.

## Medições

| Verificação | Resultado |
| --- | --- |
| Integração completa (`npm run test:integration`) | 702 testes: 695 passaram, 5 pulados, 2 falharam na rodada completa. Uma falha era uma asserção errada do teste novo de teto (corrigida; suíte de enriquecimento 17/17). A outra é o teste de desempenho de Relatórios, com p95 de 254,9 ms contra a meta local de 250 ms; a suíte de Relatórios sozinha passou 13/13. A rodada completa não foi repetida depois dessas duas correções |
| Suíte da jornada (`06b5`) depois do arquivamento no worker | 33/33 |
| Unitários (`npm test`) | 464/464 |
| Jornada de navegador `full-journeys.mjs --only=pack` | 1/1, resíduo zero |
| Três telas em 1920×855, 390×844 e 320 px | sem transbordo horizontal; capturas em `output/playwright/06b7-staged/` |
| `npm run build`, `tsc --noEmit`, `git diff --check` | ok, medidos depois das correções da revisão |
| Auditor de cobertura | 8/138, inalterado; relatórios globais anteriores seguem fora do hash atual |

## Limites desta prova

- **Referência ao vivo não comparada.** A extensão do Chrome não estava conectada. A comparação usou a captura arquivada EV-027. Diferenças antigas no Enriquecedor permanecem: rótulo "Enriquecer" na referência contra "Ver preview", link "Comprar créditos" e contador de "já enriquecidas".
- **Teclado, papéis na interface e falha de rede** nas três telas não foram exercitados além do que a jornada `pack` cobre.
- **"Ainda não enriquecida"** não é filtro de elegibilidade. O lote clássico reutiliza o cache por CNPJ sem novo crédito; resultados antigos do fluxo `companyPeople` usam outro cache e não são reaproveitados.
- **Lote clássico exige os perfis CNPJ e WEB da Apify** e reserva até três execuções por empresa nova. A cobrança comercial segue em 1 crédito por empresa com contato útil.
- **Motivo do teto não aparece no item.** A empresa que fica fora do teto de créditos aparece como ignorada, sem dizer que foi por orçamento.
- **Sem fornecedor real.** Todas as execuções usaram fontes simuladas em banco efêmero. Rendimento, custo e taxa de acerto de CNPJ para leads do Maps ficam para o 06B.6e.

## Próximo passo

Homologação real por módulo (06B.6e e 06IA-H), com escopo e limite de gasto autorizados pelo operador para cada rodada. Em paralelo, a regressão local do 06A-V/08A e a preparação local do 08B não dependem dessa autorização.
