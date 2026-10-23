# Piloto Gmail: envio, resposta e leitura da inbox

## Evidência real

- Conta Google autorizada no app, com permissões de envio e leitura verificadas.
- Limites explícitos salvos: 5/dia no workspace, canal de e-mail e caixa; intervalo de 60–180 segundos.
- Um único teste foi revisado e confirmado pelo usuário no app. Dispatcher executado com workspace e ID exatos, uma vez, máximo de uma mensagem. Recibo Gmail aceito, uma tentativa, nenhum bloqueio. O usuário mostrou a mensagem recebida na caixa de entrada pessoal.
- O usuário respondeu. Uma execução de sincronização restrita à caixa leu duas mensagens, completou sem gap/erro e persistiu a resposta humana.

## Defeito de associação encontrado e corrigido

O Gmail substituiu o Message-ID proposto pelo app. O recibo já continha o ID remoto exato da mensagem enviada, mas a sincronização ignorava a observação em Enviados por não encontrar o RFC original. A resposta foi criada em outra conversa.

A migração 057 aprende o RFC e o thread ID observados somente quando workspace, caixa, recibo aceito, remetente e destinatário único coincidem. A observação de Enviados precede a associação das respostas no lote, independentemente da ordem recebida. A reconciliação anterior por RFC exato continua disponível para resultados incertos; nenhuma transmissão é repetida.

O teste reproduziu duas conversas antes da correção e passou a produzir uma conversa com envio e resposta, parada da cadência e replay sem duplicatas. Casos negativos verificam que outro recibo, remetente ou destinatário não alteram a identidade aceita. A migração foi aplicada ao banco local.

As duas mensagens do piloto foram reunidas em transação com prova obtida por leitura da mensagem real no Gmail, IDs exatos, mesma identidade e referência de resposta. Backup de metadados e cursores ficou somente no diretório local ignorado. O primeiro ensaio interrompeu e reverteu por detectar um cursor de leitura; a execução final preservou esse cursor, reaplicou os efeitos da resposta e registrou auditoria. Conferência final: uma conversa, duas mensagens, uma recebida. Nenhum novo e-mail foi transmitido durante a correção.

## Apresentação

O usuário autorizou decidir e implementar o ajuste. A identidade visual foi preservada. A inbox agora usa cartões de e-mail, mensagem mais recente aberta, anteriores expansíveis, remetente/horário/estado e texto novo em destaque. Citações reconhecidas em português/inglês são recolhidas apenas na apresentação; o texto armazenado não é alterado. Casos desconhecidos permanecem inteiros. Dados técnicos, filtros e ações ficam acessíveis por disclosure.

Verificação renderizada com os componentes reais e dados fictícios: desktop 1440px e viewport móvel 390px, sem overflow horizontal; expansão de citações e mensagens anteriores funcional. A rota temporária foi removida antes do build. Detector executado uma vez: somente dois avisos preexistentes de animação de largura/margem fora deste ajuste. Revisão independente encontrou uma colisão de especificidade CSS, corrigida com seletores próprios da inbox. Sem achados de segurança/isolamento/perda de dados na alteração revisada.

## Verificações

- Unitários: 214/214 aprovados.
- Integrações de envio, recebimento, sincronização, inbox e HTTP: 34/34 aprovadas.
- TypeScript aprovado. O primeiro build posterior compilou, mas encontrou tipos gerados da rota temporária já removida; o cache específico dessa rota foi limpo. O build final webpack passou, incluindo tipos e geração de todas as páginas.

## Desempenho e ambiente de teste

O servidor de desenvolvimento foi substituído por `npm start` após o build, na mesma origem 127.0.0.1:3210 e com o mesmo banco. Adicionado fallback de carregamento no grupo autenticado para feedback durante transições. Nenhum dado autenticado foi colocado em cache global.

Medição HTTP sequencial com a mesma sessão válida do usuário, dois acessos por rota; somente rota/status/duração/tamanho foram registrados, sem cookies ou conteúdo. Valores em milissegundos:

| Rota | Dev primeiro / segundo | Produção primeiro / segundo |
| --- | ---: | ---: |
| Dashboard | 4386 / 276 | 401 / 40 |
| Configurações de e-mail | 692 / 169 | 43 / 98 |
| Inbox de e-mail | 213 / 189 | 68 / 30 |
| Automações | 3619 / 240 | 35 / 26 |
| Relatórios | 2475 / 209 | 29 / 57 |
| API de caixas | 409 / 29 | 213 / 15 |
| API de conversas | 91 / 35 | 28 / 12 |

Todos os acessos retornaram 200. São amostras locais de resposta HTTP, não medições completas de interação/renderização no navegador nem garantia de desempenho em produção pública. Os logs de desenvolvimento também mostraram uma rota com 21,7s de compilação em 22,4s totais e abertura do histórico com 6,9s de compilação em 7,3s totais. O ambiente tinha aproximadamente 0,85GiB de memória física livre durante um dos builds; não foram encerrados processos de outros projetos/aplicativos.

Os workers contínuos de sincronização e transmissão permanecem desligados no ambiente. O piloto não configura Meta/Twilio nem comprova quotas, reputação ou operação pública em massa.
