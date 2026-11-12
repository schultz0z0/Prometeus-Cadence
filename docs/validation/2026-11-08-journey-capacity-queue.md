# Prospecção completa e capacidade interna

Em uma assinatura Essential simulada, a revisão anterior bloqueou um pedido de duas empresas mesmo com 250 extrações disponíveis. A política técnica do workspace comportava uma chamada da Apify por dia. A revisão comparava esse teto à estimativa da captação inteira.

A confirmação agora reserva o saldo comercial pela origem escolhida. O worker reserva capacidade para cada operação externa e para as páginas que ingere. Se a cota técnica estiver ocupada, a etapa fica em espera por um minuto antes de poder ser reclamada. A espera deixa a vaga do worker disponível e mantém os recibos e a reserva de extração. O cancelamento pode ser processado durante a espera. Uma chamada incerta ainda exige conciliação.

Em banco efêmero, o primeiro lote consumiu a chamada disponível. O segundo aguardou. Com a renovação da capacidade simulada no banco, a mesma execução seguiu e o primeiro lote não foi chamado novamente. Durante a espera, o saldo disponível caiu de 250 para 248, uma nova solicitação de 249 foi recusada e o saldo reservado voltou ao plano no término sem entregas.

A revisão independente apontou que um lote indivisível maior que o teto ficaria aguardando indefinidamente. O teste falhou com uma página de cinco diante de um teto de dois. A correção limitou a página a dois e a ingestão contabilizou os dois candidatos. Quando uma operação indivisível exige capacidade que a instalação nunca disponibiliza, a execução registra `CAPACITY_CONFIGURATION`.

No Chrome local, a revisão de duas empresas em uma conta Essential descartável mostrou 250 disponíveis na franquia e retirou a estimativa técnica do formulário. O roteiro encerrou com zero jobs para o workspace de teste e resíduo zero de conta. As chamadas externas nos testes de worker usaram simuladores.

Passaram 460 testes unitários, 52 testes de integração das áreas alteradas, o build, a checagem de tipos e `git diff --check`. A suíte completa de integração terminou com 678 aprovados, zero falhas e cinco cenários reais do Stripe pulados. O auditor global de aceite marcou os relatórios anteriores de varredura e jornadas como desatualizados pelo hash atual do código. Esta validação cobre a mudança de capacidade.

A migração 113e foi exercitada em banco efêmero e aplicada em 08/11/2026 à instalação local compartilhada, com zero prospecções ativas antes da atualização. O build atualizado está na porta 3210, o login respondeu HTTP 200 e o worker executou um ciclo com sucesso. O teste de 250 confirma o dimensionamento e a segunda consulta. Entregar 250 empresas verificadas, a cobertura além dos dois lotes Maps e a integração do fluxo CNPJ primeiro continuam em aberto.
