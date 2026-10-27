# Revisão final — 06B.4

27/10/2026. Uma revisão independente, contexto novo, `gpt-6-astra/high`, intervalo `f8e870e..9c6f72a`. Cinco achados importantes mantidos nessa gravidade; zero críticos e zero menores. Uma rodada de correção pelo implementador, com regressões RED→GREEN; sem segunda revisão.

| Achado importante | Efeito e correção | Regressão |
| --- | --- | --- |
| Contato explicitamente de outra pessoa atribuído ao gestor próximo | Exige que o último rótulo de atribuição nomeie exatamente o dono do e-mail/telefone; proximidade não comprova titularidade. Validador compartilhado endurecido. | `another named persons explicit email attribution overrides incidental proximity to this manager` |
| Cache de caso que não chegou a ser consultado | `LIMITE_DO_LOTE` e `CACHE_EXPIRADO` não são cache reutilizável. Outra consulta depende de nova revisão; expiração prometida continua sem autorizar chamada paga automática. | `budget and expired-cache placeholders do not poison the next explicitly reviewed lookup` |
| Modelo omitia o prefixo de cargo anterior | O qualificador é lido na citação da pessoa, além do cargo proposto; contato fica inconclusivo e não aplicável. | `a stripped model role cannot erase the former-role qualifier in the source quote` |
| Nova chamada após mudança de dados/contexto/permissão | Base completa, contexto aprovado, papel, elegibilidade, versão e rota são repetidos antes de nova coleta, início de Actor, inferência e JEV. Receipts de I/O já recebido são preservados. | `changed source or context during a received page stops every later provider dispatch`; caso híbrido muda base após inferência e comprova zero nova chamada JEV |
| Viewer rebaixado continuava reclamando job e segurando saldo | Claim/heartbeat/cleanup reconhecem revogação de escrita apenas no modo novo. Job conhecido é cancelado e saldo não gasto liberado; run remoto tem cleanup uma vez; início incerto conserva reserva para reconciliação. Função SQL restrita ao worker, actor/lease/fence corretos e revogação real. | `viewer downgrade before dispatch or during I/O durably cancels and releases the unspent reservation`; `viewer downgrade cleans a known remote run once while an unknown start stays reconcilable`; `revocation cleanup cannot cancel an authorized writer, a foreign job or a stale lease` |

Os cinco casos falharam antes das respectivas correções. O contrato passou a `company-people-v2`; a migração complementar `084c` mantém os históricos/ledger anteriores, mas retira suporte atual e atribuição pessoal das extrações v1. Não se reescreveram migrações aplicadas nem se concedeu escrita ampla ao cliente/worker.

## Pontos fora do julgamento e decisões

1. **Cobertura, custo e acurácia live dos fornecedores:** mantidos para o piloto autorizado06IA-H; fixtures provam o contrato/invariantes, não a qualidade real. Custo se errado: rever cobertura/perfis e estimativas antes da oferta pública.
2. **Estados pagos/conectados inacessíveis da referência:** permanecem não observados, conforme escolha do usuário. Custo: pode haver diferença visual/funcional nesses estados; não há aceite de réplica integral.
3. **Carga e capacidade pública:** aceite continua em08B. Custo: validação local não garante escala/operabilidade pública.
4. **Deduplicação global de aplicações distintas intencionais:** mantida idempotência por operação; não inventada política nova.06E.2 trata fusão/deduplicação geral. Custo: confirmações distintas podem criar contatos duplicados.

Nenhum achado menor para implementar ou adiar nesta revisão. O menor histórico de seleção inicial do lote de06B.3 permanece no relatório próprio, com polimento atribuído a06B.5; o novo modo tem seleção explícita por empresa.

## Verificação de liberação

Confirmados após a rodada: 330/330 unitários, 354/354 integrações completas e 17/17 focadas; build de produção/tipos/diffcheck aprovados; seis capturas pós-revisão em1920/390/320 sem overflow/erro; localhost200 e seis lanes saudáveis. QA adicional revogada. O [relatório do pacote](06b4-company-people.md) registra os números efetivamente confirmados e os limites do aceite.
