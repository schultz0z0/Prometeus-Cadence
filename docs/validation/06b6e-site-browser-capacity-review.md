# Revisão independente do 06B.6e

O revisor, em modo somente leitura, observou que o saldo diário agrega `held` e `spent`. As duas asserções de saldo poderiam passar com uma reserva ainda aberta. A prova passou a conferir a alocação da execução, o consumo efetivo, a retenção zerada e a reserva encerrada em cada workspace.

A revisão também separou a admissão sintética do desempenho real. O cenário usa novas concessões para a mesma execução e adianta o prazo de retentativa no banco efêmero. As chamadas diretas ao worker dispensam a espera do supervisor. O runner mantém seu provisionamento preexistente do papel PostgreSQL global antes de criar o banco de testes. A coleção Chromium real foi medida em uma rodada separada, sem rede externa.
