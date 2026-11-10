# 06B.6e — Troca controlada do worker local

Em 09/11/2026, o supervisor substituiu somente a lane `jobs`. A troca exigiu processo ocioso, telemetria recente, PID e parentesco verificados, porta do app livre e um bloqueio breve no Postgres local. A conexão administrativa leu o estado global com proteção contra filtragem silenciosa de RLS. Havia zero jobs em fila, processamento, espera de provedor ou cancelamento, zero jornadas em execução e zero automações ativas.

O filho substituto concluiu dois ciclos, com o PID do supervisor e os PIDs das outras dez lanes preservados. Os contadores de jobs, tentativas e consumo permaneceram estáveis. Os dois jobs históricos em reconciliação ficaram intactos. O gateway respondeu ao cliente autenticado e a tabela de páginas manteve RLS forçada.

A revisão independente foi somente leitura. Ela orientou a contar todos os estados que permitem trabalho, incluindo leases vigentes e retentativas futuras, e separar a prova do gateway da prova do processo. Os ciclos ociosos confirmam o restart e o acesso do worker ao banco. A coleta do worker pelo gateway ainda depende da homologação operacional.

No Chrome, a jornada `pack` exibiu o navegador disponível e abriu a revisão em 1920×855 e 390×844. O servidor temporário estava em modo de revisão, com execuções externas desabilitadas. A conta descartável foi removida com resíduo zero. O servidor de prova foi encerrado após a rodada.

## Piloto cadastral

O operador autorizou as duas consultas iniciais e uma nova consulta da faixa até 2019, após o primeiro HTTP 429 da Minha Receita. O build cadastral retornou um cadastro válido e distinto em cada faixa. [Relatório do piloto](06b6e-cnpj-actor-pilot.md)

O protocolo aprovado usou CNAE 2512800 em Curitiba/PR, até um cadastro e teto de US$ 0,05 por execução, com reinício automático desativado. A conferência foi em memória e a evidência registra contagens, cobertura e custo.

Com zero jobs em andamento, zero jornadas em execução e zero automações ativas, `APIFY_CNPJ_DATE_SLICES` foi ativado localmente para novas revisões. A política congelada no job dispensa um novo restart do worker. A jornada `pack` passou com os avisos de disponibilidade do navegador e das duas faixas e revisão em 1920×855 e 390×844. A conta descartável deixou resíduo zero e o servidor temporário foi encerrado. A prova em banco efêmero teve um cenário de busca nova com resultado parcial e um cenário com dados reaproveitados que inseriu um lead com evidência real do Chromium. [Piloto da Prospecção completa](06b6e-prospecting-live-pilot.md)

[Limite de cobrança por execução na Apify](https://docs.apify.com/api/v2/actors-runs-post)
