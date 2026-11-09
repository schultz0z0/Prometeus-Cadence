# 06B.6c — Recortes complementares por data de abertura

Com a opção `APIFY_CNPJ_DATE_SLICES=true`, a revisão da Prospecção completa congela duas faixas de abertura. O primeiro recorte começa em 01/01/2020 e tem até 60% do teto técnico. Se a busca ficar abaixo da meta, o segundo termina em 31/12/2019 e usa o saldo técnico da execução. Ambos exigem CNAE principal, município, UF e situação ativa. A confirmação continua reservando apenas a quantidade comercial solicitada.

O worker grava o avanço no checkpoint, usa uma tentativa distinta por recorte e registra os CNPJs examinados junto ao recibo da página. Antes de consultar Maps, descarta datas ausentes ou incompatíveis e CNPJs já examinados no mesmo job. O usuário vê o motivo em Execuções. Uma jornada já confirmada conserva sua política quando o operador muda a configuração para novas revisões.

A reconciliação de uma consulta cadastral exige Actor, build e dataset, além do INPUT da faixa pendente. Recusa data de início anterior à tentativa, com tolerância de cinco segundos, e um run já vinculado no mesmo workspace. A intervenção ainda depende da confirmação administrativa de que o run corresponde à operação incerta.

## Alcance

- A Apify pode cobrar uma linha já entregue antes do descarte local. A ausência de sobreposição no provedor depende de o build respeitar os filtros de data. O aplicativo evita repetir as consultas de Maps e de busca web daquele CNPJ dentro da mesma execução e só debita leads efetivamente inseridos.
- Se o primeiro dataset devolver um cadastro do recorte principal com data incompatível ou ausente, o worker encerra o resultado parcial antes de abrir o segundo Actor. A decisão evita ampliar o custo quando o filtro inicial não pode ser confirmado.
- As duas faixas preservam o recorte comercial aprovado e o teto técnico original. Fontes esgotadas, registros sem data e vínculos inconclusivos podem produzir resultado parcial. Uma nova execução revisada separadamente pode voltar a consultar a fonte.
- A configuração compartilhada segue sem ativar os recortes até o piloto verificar o build configurado. A ativação do worker compartilhado e o piloto real continuam registrados no 06B.6e.

## Verificação local

- A regressão provou a troca entre duas faixas, o bloqueio de expansão diante de uma data incompatível, a reconciliação da tentativa certa e a cobrança de uma única inserção. As respostas externas foram simuladas no Postgres efêmero.
- O cenário de capacidade com as duas faixas entregou 250 empresas após quatro rejeições, com duas buscas cadastrais e 254 consultas ao Maps simuladas. A liquidação encerrou as reservas. Foram 555 turnos e 748,9 s, com a suíte padrão em paralelo durante parte do teste. Esse tempo pertence ao cenário sintético.
- No Chrome local, o Gerador exibiu o aviso de duas faixas e abriu a revisão em 1920×855 e 390×844. A execução externa estava desabilitada e a conta descartável foi removida com resíduo zero. Capturas em `output/playwright/registry-first/`. O aviso descreve uma regra específica do Prometeus.
- Build, checagem de tipos e 462 unitários passaram. O auditor global permanece em 8/138 para o hash `76e1fe46e6b1ac6d70469c18c01a02de8fa63cad65b99a5c8c5e6cd1b69809aa`, com os relatórios anteriores do 08A fora do hash atual.
- A suíte padrão teve 686 aprovações, cinco casos reais de Stripe desabilitados e duas falhas fora da prospecção. O teste do feed recebeu 200 quando esperava 429, e o teste de devolução de e-mail encontrou `EADDRINUSE` ao conectar ao Postgres. Ambos passaram nas repetições isoladas. A checagem da base manteve os quatro erros históricos de `clone/barriers.md`.

[Contrato de entrada e saída do Actor](https://apify.com/bigdavidson/brazil-cnpj-companies) · [Leitura do armazenamento associado ao run](https://docs.apify.com/api/v2)
