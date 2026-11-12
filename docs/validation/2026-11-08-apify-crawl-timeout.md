# Tempo limite do crawler na Prospecção completa

As duas buscas reais de 08/11 terminaram com `INVALID_RUN_STATUS`. O último crawler em cada uma retornou `TIMED-OUT`. O adaptador esperava `TIMED_OUT` e interrompia toda a captação antes de ler o dataset. As execuções registradas somaram 19 Actors e US$ 0,138102 segundo os metadados retornados pela Apify.

`TIMING-OUT` permanece em andamento. Ao confirmar `TIMED-OUT` no crawler de site, o worker lê o dataset existente, guarda o resultado da leitura no histórico da execução e aplica os critérios normais de admissão. Não repete o POST de início. O timeout de outros Actors continua sendo um encerramento malsucedido.

A regressão usa o adaptador real com transporte simulado. Antes da mudança, o estado intermediário interrompia a jornada. Depois, a jornada aguardou o encerramento, leu a evidência institucional, consultou o cadastro simulado, admitiu a empresa e registrou um único início de crawler. Passaram 25 testes da jornada, 10 testes direcionados dos adaptadores e a checagem de tipos.

A releitura das duas execuções antigas usou apenas GET. O adaptador recuperou 7 e 10 páginas. Nenhuma continha um CNPJ válido detectado pelo extrator. As execuções históricas permaneceram intactas. Uma nova rodada paga permanece pendente.
