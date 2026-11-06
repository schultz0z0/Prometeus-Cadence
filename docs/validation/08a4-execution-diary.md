# 08A.4 — Diário de Execuções

O diário em `/executions` lê mensagens de publicações de cadência com as permissões do workspace. O histórico de pesquisas, qualificações e análises continua em `/executions?view=jobs`. Os links de detalhes e o filtro legado por automação continuam resolvendo os jobs.

## Dados e comportamento

- O GET valida sessão, workspace e filtros e usa a transação com RLS. Mensagens avulsas ficam fora. A resposta contém metadados do diário, com motivos públicos, sem texto da mensagem, conteúdo de tentativas ou identificadores do provedor.
- A tabela mostra o resultado mais recente conhecido por mensagem. Aceite, entrega e leitura são evidências de sucesso. Uma devolução de e-mail ou falha posterior prevalece. Um envio incerto indica que falta confirmação. O diário mostra os motivos mapeados para cancelamento, bloqueio e adiamento. Nos demais casos, exibe uma descrição genérica do estado.
- Busca e período filtram os resultados com o fuso do workspace. Os cartões contam mensagens antes do filtro de status e da paginação. A opção de rastreio acrescenta tentativas registradas à tabela, sem contá-las como novas mensagens nos cartões.
- A leitura só cobre mensagens registradas. Etapas interrompidas antes de gerar uma mensagem e rastreios internos que o motor não persiste ficam fora. A opção LinkedIn consta da referência. Ela não habilita o canal nem aciona provedor.

## Referência visual

A evidência EV-038 descreve cartões, opções de filtro, cabeçalho da tabela, estado vazio e paginação. As capturas locais foram comparadas em 1920×855 e 390×844 com a referência guardada. A ilustração do estado vazio foi redesenhada com base na área mascarada. A faixa móvel do teste mantém a apresentação do shell do projeto. A referência disponível mostra a lista vazia, de modo que linhas preenchidas, carregamento, falha e recuperação têm prova local. [EV-038](../reverse-engineering/reaudit-2026-10-24/evidence/EV-038-executions.txt)

Em 1920×855, os cartões começam a 190 px, a busca a 304 px e a tabela a 360 px nas duas capturas. O quadro vazio local termina cerca de 3 px mais abaixo. Em 390×844, as duas telas quebram os cartões em duas colunas e os filtros em duas linhas abaixo da busca. A faixa móvel local mede 63 px, contra 80 px na referência, e antecipa o início da área do diário. As quatro capturas locais `diary-empty-*.png` e `diary-rows-*.png` ficaram em `output/playwright/visual-audit/`.

## Segurança da rodada

Contas fictícias `[RE]` e e-mails `example.com`. A massa do navegador usa mensagens terminais, publicação pausada, inscrição parada e canal desconectado. Nenhum job ativo, envio, provedor pago ou escrita no Stripe foi necessário. O navegador bloqueou hosts externos.

As primeiras inicializações do Next herdaram a telemetria habilitada. A transmissão dessas tentativas ficou indeterminada. O build usado no QA e seu servidor rodaram com `NEXT_TELEMETRY_DISABLED=1`.

## Verificação

Os casos de devolução e adiamento falharam antes da correção. A rodada focada de integração que confirmou as duas correções passou com 13 de 13 casos. [Revisão](08a4-execution-diary-review.md)

A jornada focada no build local passou nas cinco etapas com 27 mensagens de cadência e uma avulsa excluída do total. Foram verificados estado vazio, resultados, paginação, busca, teclado, largura de 320 px e recuperação de um 503 simulado. A limpeza retornou zero resíduos.

- Unitários: 457 aprovados. Build e tipos concluídos com código 0.
- Integração completa: 659 aprovados, três falhas e cinco cenários do Stripe pulados. As duas falhas conhecidas são `07A.3b assisted` e `07A.3c approving`. A correção de horário continua em `6c0c618`. A terceira falha foi o benchmark de 10 mil registros do 06C.2, com p95 de 303 ms em uma rodada concorrente com o build e o navegador. Na rodada focada de 13 casos, o mesmo benchmark mediu 115 ms e passou sob o limite de 250 ms.
- Medição final com o build local: 22 de 22 jornadas e 576 de 576 visitas em 72 rotas e oito configurações. Os dois relatórios têm o hash do código atual e ambas as limpezas retornaram zero resíduos. A primeira rodada de desenvolvimento foi interrompida após falhas de recarga e não integra essa contagem. [Jornadas](evidence/08a-final-regression/journeys.json) · [Varredura](evidence/08a-final-regression/route-sweep.json)
- Auditor: **104 de 127 aceitos**. O diário acrescentou uma prova ao registro. O aceite integral segue pendente, com 17 bloqueios externos, seis pendências e quatro estados da referência desconhecidos com prova local. [Matriz](08-release-matrix.json)
- `git diff --check` passou. O `check-kb` encontrou apenas os quatro erros já registrados em `clone/barriers.md` e o aviso existente sobre o nome de `evidence/index.csv`.
