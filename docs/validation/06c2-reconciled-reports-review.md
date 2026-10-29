# Revisão independente06C.2

**Data:**29/10/2026. **Revisor:**agente com contexto novo, GPT-6 Astra/high, somente leitura; uma única revisão. **Faixa:**57e6e233baf9ee15164ec4e6736a1093407051d6..22a461659ddacf5e32f7f296b3703d4639f40c7f. Plano/desenho/ReviewFocus e rulings completos fornecidos. Nenhum arquivo ou dado operacional alterado pelo revisor.

## Pontos positivos

Fatos autoritativos compartilhados entre totais/séries/detalhe/legado; autorização e isolamento no caminho HTTP; telemetria indisponível comnull; limitações de atribuição/coorte documentadas; filtros e polling protegidos contra respostas antigas; evidência local sem alegar SLO público ou paridade total.

## Importantes — correção obrigatória

1. **Cursor perde microssegundos.** `src/server/operations/reports.ts:19,27`: SQL ordena/compara timestamptz completo, mas o cursor derivava do ISO deDate, limitado a milissegundos. Registros restantes no mesmo milissegundo podiam ser pulados. Exigir travessia completa de mais de50registros com timestamps de microssegundos e cardinalidade igual ao total.
2. **Card de canal abre população maior.** `src/modules/reports/reports.tsx:37`: cards de e-mail e WhatsApp abriam ambos o indicador geral `sent`. A observação “todos os canais” não faz o detalhe corresponder ao número visível. Exigir métricas/filtro específicos com fonte/cursor autorizados e fixture mista.

Reclassificação do executor: ambos permanecem Important pelo impacto nos registros que a pessoa consegue conferir. Uma passagem de correção RED→GREEN; sem nova revisão.

## Menores — adiados para08A

1. **93dias de calendário atravessando DST de outono.** `src/domain/reporting.ts:25`: seletor permite93datas, mas limite absoluto93×24h rejeita a hora extra. Reproduzido em2026-08-01/2026-11-01 America/New_York. O pedido é recusado, sem produzir número incorreto; alinhar contrato/calendário/SQL no08A.
2. **NULL explícito no force SQL.** `db/migrations/089-report-projections.sql:79`: operador pode passarNULL, fazendo a condição de rejeição e o cache-hit resultaremNULL; ocorre recomputação. Sem ampliação de dados/permissão de escrita, e operador já pode materializar consultas novas. Normalizar/rejeitarNULL e cobrir chamadaSQL no08A. Não tratado como falha de isolamento; custo é recomputação indevida.

## Itens não julgados e decisão do executor

- **Nova entrega externa/provedores:** pacote lê histórico e testes controlados sem novos envios/chamadas pagas. Decisão: manter gate próprio de piloto externo; custo se incorreta: histórico persistido não demonstra uma nova entrega.
- **Paridade exata de estados pagos/conectados não observados:** exclusão explícita anterior do operador. Decisão: manter não observado, sem aceite100%; custo: diferenças só serão confirmadas quando houver ambiente acessível.
- **Latência/SLO público:** medição é do perfil local do plano. Decisão: exigir carga/implantação no08B; custo: infraestrutura pública pode ter latência distinta.

**Veredito original:** pronto com correções dos dois Important; nenhum Critical. O revisor não repetiu suítes amplas. Resultado das correções e verificações finais será adicionado pelo executor, não por uma segunda revisão.

## Resultado da passagem de correções

Executor: ambos Important corrigidos com regressões RED→GREEN. Cursor50/120→120/120 IDs únicos; publicação/dispatch misto2e-mails+1WhatsApp e detalhes dos canais exatos. A fixture segue o próximo horário persistido, sem depender do dia da semana. Suíte final432/432integrações,355/355unitários,11/11focadas; build/tipos/diff verdes. Oito verificações de UI pós-revisão,38capturas/32checks totais. Dois menores adiados explicitamente→08A. Nenhuma nova revisão foi solicitada.
