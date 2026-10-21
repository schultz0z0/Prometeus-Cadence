# Apify Free — primeiro lead real

21/10/2026. Configuração local e teste explicitamente autorizado pelo usuário, que forneceu a credencial e escolheu “Clínicas de estética em Curitiba — PR”. Nenhum segredo consta neste documento.

## Configuração e limites

- Token gravado somente em `.env.local`, ignorado pelo Git. `GET users/me` confirmou a conta informada e plano Free. `GET users/me/limits` mostrou limite mensal US$ 5 e uso US$ 0 antes do teste. Nenhuma assinatura ou compra efetuada.
- Única fonte habilitada: MAPS, Actor `compass/crawler-google-places`, build `0.14.775`, PPE verificado.
- Reserva do primeiro teste: um candidato e um run por workspace; global um candidato e dois runs, pois há uma reserva antiga de um run em outro workspace aguardando reconciliação. A reserva antiga não foi removida/reprocessada. Apenas um novo run foi autorizado e iniciado.
- `maxTotalChargeUsd=0.5`, mínimo exigido pelo Actor; sem extras de contatos/pessoas, imagens ou reviews. As demais fontes continuam indisponíveis por perfil não configurado. Scheduler permanece desativado e não foi iniciado um worker contínuo.
- Nenhuma alteração de quota Codex/LLM ou teste de inferência.

## Caminho real

O smoke do próprio aplicativo preparou e confirmou o job pelas regras normais de autorização, quota e revisão. Worker executado com `--once` e restrição explícita ao workspace. POST de início único; retomada por run/dataset persistidos. Segundo passo do worker coletou e importou o resultado. Servidor local reiniciado para ler a configuração; `/login` respondeu 200.

| Campo | Resultado |
| --- | --- |
| Workspace | QA · Marco 04 · revisão visual |
| Workspace ID | `a801c8b3-727f-40a1-94b2-422a1a74ef34` |
| Job | `d044ae6a-0080-41cd-a076-4d65e5e6692f` |
| Lista | `4ce6bf9e-abab-46df-b660-99b13b738f36` |
| Run Apify | `O00X2abH1FP67OGA9` |
| Dataset | `9a3i9KSnwTtYoF1RV` |
| Estado remoto | SUCCEEDED |
| Estado no aplicativo | completed |
| Contagens | 1 encontrado, 1 inserido, 0 duplicados, 0 rejeitados |
| Empresa | For Derm Clinic \| Por Dra Andressa Faucz |
| Cidade / UF | Curitiba / Paraná |
| Site retornado | https://fordermclinic.com.br/ |
| Qualificação | pending — não houve qualificação por IA |
| Consumo remoto registrado | US$ 0,0042 (`usageTotalUsd` do run) |
| Duração remota | Cerca de 11 segundos |

O ledger interno conta um candidato e um run e preserva custo monetário desconhecido, conforme o contrato existente. O valor monetário acima foi conferido no próprio run Apify; não foi inventado no ledger. Armazenamento/uso posterior da plataforma pode ser contabilizado separadamente.

## Verificação negativa

Uma segunda confirmação normal de um lead, sem chamar worker ou Apify, foi rejeitada com `USAGE_LIMIT`/429. Isso confirma que a quota deste primeiro teste foi consumida e impede repetição inadvertida. Não foi aumentado o limite depois do teste. Novos testes precisam de uma quota deliberadamente ajustada; essa é uma quota do aplicativo, não esgotamento dos US$ 5 do Apify.

## Limites do aceite

Teste real do Google Maps, não de CNPJ, SERP, leitura do site, precisão em escala ou geração de mensagens. Os contratos Web/CNPJ identificados no estudo ainda precisam de correção antes de liberar suas execuções. Nenhum envio de mensagem, nenhuma nova inferência e nenhuma automação recorrente foram executados.
