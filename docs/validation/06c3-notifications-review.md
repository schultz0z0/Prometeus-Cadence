# Revisão final —06C.3

30/10/2026. Uma revisão independente em contexto novo por GPT-6 Astra/high, intervalo imutável87dab50..753501242b81db268bc071278e6c2b14041fc285. Pacote e decisões arquivados na [evidência](evidence/06c3-notifications/execution-ledger.md). Sem Critical; sete Important mantidos por impacto ao usuário, corrigidos numa única passagem RED→GREEN, sem segunda revisão.

| Achado Important | Correção/regressão | Evidência observada |
|---|---|---|
| SQL payload revision / shared summary poison | direct SQL rejects missing or mismatched payload revision; summary uses authoritative revision and isolates malformed legacy rows | six pre-fix failures9/15, including NaN22P02; focused15/15 |
| reply/failure source revocation | lead_reply and delivery_failed delivery cancelled after originating connection disconnect | pre-fix1send vs0 for each; fixed0 |
| recurring outage identity | second outage after recovery; repeated ticks and revisions deduplicate | pre-fix1item vs2; fixed2 |
| polling pagination boundary | loaded window35 + new head1 preserves36 | immutable7535012 expression returned35 vs36; current unit and browser36 |
| revoked paginated cache | HTTP403 suppresses every loaded page | pre-fix browser retained5older items; fixed0 |
| email connection destination | email attention points to email settings; WhatsApp to its settings | pre-fix two WhatsApp paths; fixed one per channel |
| Account stale preference recovery | explicit current-revision rebase retains summary intent and concurrent badge | pre-fix missing recovery control; fixed desktop/mobile save after explicit review |

Migração090c é progressiva;090/090a/090b aplicadas não foram editadas. A revisão real fica na coluna, o contrato SQL é completo e o worker adia por uma hora somente o resumo legado inválido. A origem dos avisos usa FK própria, independente da chave de incidente. O claim serializa a revogação com lock da conexão. Lista carregada é reconciliada e suprimida sem autoridade; Conta permite recuperar a revisão preservando apenas a frequência de resumo pretendida e exige salvar novamente.

Verificação após correções:363/363 unitários;447/447 integrações;15/15 focadas; build webpack e tipos posteriores exit0. Navegador real comprovou36itens após polling e0após403, conflito409 e recuperação desktop/mobile. A primeira injeção403 usou campo error em vez de message: houve timeout do locator, e inspeção posterior comprovou5itens antigos ainda visíveis. O roteiro foi corrigido para a resposta HTTP real; não contar o timeout como teste verde. A condição de paginação antiga também foi reproduzida diretamente da expressão no commit imutável,35em vez de36.

## Menor adiado

Owner08A: a fixture semanal usa timestamptz::text sem T e now()-3days sem garantir a semana anterior. Portanto o teste não prova a exclusão de um fato elegível positivo do workspace vizinho. O SQL é escopado, mas essa lacuna de prova permanece explícita; não foi alterada durante a passagem de Important.

## Questões deixadas ao implementador

As nove decisões, com motivos/custos, estão integralmente no [ledger](evidence/06c3-notifications/execution-ledger.md) e em [rulings.json](evidence/06c3-notifications/rulings.json): pilotoSMTP/TLS externo; destino/transporteWhatsApp; produtoresSDR; frequência única sem mensal; primeira resposta/inclusão do agente; silêncio que adia em vez de descarte comercial; opt-in legado; cobertura visual parcial; incerteza sem reenvio automático. Nenhum desses itens recebeu comprovação externa por capturador local.

Aceite local/controlado. Piloto externo e paridade de estados não observados continuam como gates explícitos. Próximo06E.1, sem contratação/envio/merge/push/deploy nesta execução.
