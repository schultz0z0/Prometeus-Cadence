# 06B.6e — Troca controlada do worker local

Em 09/11/2026, o supervisor substituiu somente a lane `jobs`. A troca exigiu processo ocioso, telemetria recente, PID e parentesco verificados, porta do app livre e um bloqueio breve no Postgres local. A conexão administrativa leu o estado global com proteção contra filtragem silenciosa de RLS. Havia zero jobs em fila, processamento, espera de provedor ou cancelamento, zero jornadas em execução e zero automações ativas.

O filho substituto concluiu dois ciclos, com o PID do supervisor e os PIDs das outras dez lanes preservados. Os contadores de jobs, tentativas e consumo permaneceram estáveis. Os dois jobs históricos em reconciliação ficaram intactos. O gateway respondeu ao cliente autenticado e a tabela de páginas manteve RLS forçada.

A revisão independente foi somente leitura. Ela orientou a contar todos os estados que permitem trabalho, incluindo leases vigentes e retentativas futuras, e separar a prova do gateway da prova do processo. Os ciclos ociosos confirmam o restart e o acesso do worker ao banco. A coleta do worker pelo gateway ainda depende da homologação operacional.

No Chrome, a jornada `pack` exibiu o navegador disponível e abriu a revisão em 1920×855 e 390×844. O servidor temporário estava em modo de revisão, com execuções externas desabilitadas. A conta descartável foi removida com resíduo zero. O servidor de prova foi encerrado após a rodada.

## Próximo gate

Proposta de piloto cadastral, sujeito a autorização expressa. Consultar o build configurado na Apify para CNAE 2512800 em Curitiba/PR, uma execução por faixa e até um cadastro devolvido por execução. Fixar `maxTotalChargeUsd` em US$ 0,05 por run, sem reinício automático. Comparar somente a atividade, o município e a data de abertura em memória. Registrar apenas contagens, cobertura e custo, sem salvar leads. O objetivo é comprovar o comportamento das duas faixas no build antes de ativar `APIFY_CNPJ_DATE_SLICES`. A prova ponta a ponta com Maps e Chromium continua separada.

[Limite de cobrança por execução na Apify](https://docs.apify.com/api/v2/actors-runs-post)
