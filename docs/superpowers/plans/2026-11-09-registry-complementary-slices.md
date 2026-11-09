# 06B.6c — Recortes complementares de CNPJ

1. Confirmar em integração que a jornada pode esgotar um recorte sem atingir a meta, passar para outro e retomar sem repetir disparos.
2. Congelar na revisão a opção de dois recortes disjuntos por data de abertura. O primeiro começa em 2020-01-01, e o segundo termina em 2019-12-31. Ambos preservam CNAE principal, município, UF e situação ativa. O primeiro recebe até 60% da capacidade técnica, e o segundo recebe o saldo. O limite comercial continua baseado nas inserções.
3. Registrar a troca de recorte no checkpoint e usar o diário existente para retomar cada Actor. Antes de iniciar Maps, recusar uma data incompatível com o recorte e ignorar CNPJs já examinados. Preservar o caminho das execuções com política anterior.
4. Habilitar os recortes por configuração explícita do build cadastral. Validar com fontes sintéticas e não alterar a configuração compartilhada até a homologação autorizada do Actor.

[Contrato oficial dos filtros](https://apify.com/bigdavidson/brazil-cnpj-companies/input-schema)
