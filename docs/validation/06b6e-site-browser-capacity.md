# 06B.6e — Homologação controlada e capacidade

O cenário de capacidade percorre o worker, a fila e as regras de cobrança com Postgres efêmero, fontes CNPJ e Maps simuladas e conteúdo de site sintético. Os cenários do Chromium real rodam em Docker separado, com rede externa desabilitada. As duas medições cobrem camadas diferentes.

## Instalação local

A migração aditiva `113f-site-page-queue.sql` foi aplicada ao banco local. A nova tabela tem RLS habilitada e forçada. A verificação anterior observou zero automações ativas e zero execuções de prospecção reclamáveis. Dois registros históricos já estavam em reconciliação. O serviço do Scrapling foi iniciado e o cliente autenticado do app renderizou uma página pública de exemplo em 1,4 s. A chave foi configurada em `.env.local`.

A troca controlada da lane de prospecção foi realizada posteriormente. O piloto real continua pendente de autorização específica para as chamadas pagas. [Relatório da troca local](06b6e-local-worker-cutover.md)

## Navegador

Os 12 testes passaram em 16,1 s, com pico de 297,6 MiB no cgroup do contêiner limitado a 1 GiB. A rodada cobre páginas estáticas, conteúdo JavaScript, paginação por links, redirecionamentos, bloqueios de rede, liberação de recursos após timeout e autenticação do gateway. A memória é do contêiner de teste e seus subprocessos, sem representar carga de múltiplos usuários.

## Lote controlado

- A admissão inseriu 250 empresas dentre 254 registros examinados. Quatro homônimos com endereço divergente foram rejeitados. A fonte cadastral simulada começou uma vez e retornou 51 páginas. Houve 254 consultas simuladas ao Maps, uma por registro, sem repetir disparos.
- O navegador simulado recebeu 751 leituras, incluindo metadados e uma tentativa repetida após `BUSY`. O worker preservou as páginas concluídas e retomou o mesmo job. Um segundo workspace concluiu seu único contato enquanto o primeiro aguardava e recebeu 404 ao consultar o job alheio.
- O lote levou 579,25 s. Foram 555 turnos medidos, incluindo o segundo workspace, com p95 de 1,641 s por turno. O processo Node foi de 129 MiB a um pico amostrado de 282 MiB. Esses números medem o caminho de admissão simulado e o Postgres. Com o intervalo padrão de 2 s, as pausas entre essa quantidade de turnos acrescentariam cerca de 18 min 30 s antes de considerar variação no intervalo ou latência real.
- O saldo da franquia caiu de 5.000 para 4.750 no workspace principal. Uma consulta paralela, somente leitura, confirmou que a reserva final estava encerrada, com 250 extrações gastas e zero retidas. O segundo workspace registrou uma gasta e zero retidas. Essa conferência entrou na asserção do teste após a revisão independente.
- A repetição do teste com a asserção final passou em 648,33 s, com as mesmas 250 inserções, quatro rejeições e 555 turnos. Parte dessa repetição coincidiu com a suíte padrão em outro banco efêmero. A duração isolada da primeira rodada permanece a referência para comparação.

O cenário usa a admissão até a publicação dos leads pendentes. A velocidade e o rendimento com 250 sites reais, a qualificação posterior e os recortes complementares de CNPJ permanecem fora dessa medição.

## Repetição

Execute `node scripts/test-integration.mjs 06b6e-site-capacity` separadamente. A espera programada é antecipada no banco de teste, e os turnos são chamados diretamente. O tempo da prova não inclui a pausa entre turnos do supervisor nem latência, custo ou disponibilidade de fornecedores reais.

## Verificações do aplicativo

- No Chrome local, a jornada `pack` mostrou o navegador disponível e abriu a revisão da prospecção em 1920×855 e 390×844. O app de prova estava com as execuções externas desabilitadas. A conta descartável foi removida com resíduo zero, sem job de prospecção ou operação de cobrança.
- O build, a checagem de tipos e os 462 testes unitários passaram. O auditor do 08A continua em 8/138, com relatórios globais anteriores fora do hash atual. A verificação da base manteve os quatro erros históricos de `clone/barriers.md`.
- A suíte padrão de integração registrou 686 aprovados e zero falhas. Os cinco testes com Stripe real ficaram desabilitados. O p95 do cenário de Relatórios foi de 215 ms para o teto de 250 ms.

## Repetição após o piloto

O mesmo cenário sintético repetiu as 250 inserções, quatro rejeições, 256 inícios simulados, 751 leituras simuladas e 555 turnos. A execução levou 570,6 s, com p95 de 1.619 ms por turno e pico de 292 MiB no processo Node. As asserções de reposição, isolamento e liquidação passaram. A medição cobre o ambiente controlado. [Piloto com fontes reais](06b6e-prospecting-live-pilot.md)
