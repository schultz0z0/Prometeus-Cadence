# 06B.6c — CNPJ primeiro na Prospecção completa

O Gerador e o assistente de automação usam o mesmo formulário para revisar CNAE principal, município, UF, meta e saldo de captação. A revisão mostra a origem cadastral. O worker consulta CNPJs ativos, confere o estabelecimento e o telefone no Maps e tenta a busca web quando o site do Maps estiver ausente, for genérico ou não puder ser confirmado. O Chromium percorre o site e a publicação exige evidência de identidade. A investigação e a qualificação continuam como etapas separadas. A tela de execução mostra páginas lidas, pendências, falhas, bloqueios e motivos de descarte.

O lote cadastral e os resultados de Maps e busca web ficam gravados durante a coleta. Uma nova lease reaproveita essas respostas e a fila de páginas. Se o navegador estiver indisponível, a execução aguarda na mesma fila antes de iniciar outra consulta. O saldo comercial desconta as empresas novas entregues. A rodada ainda usa o limite técnico de candidatos existente, `min(500, meta × 2 + 8)`, no recorte de CNAE, município e UF revisado. Atingir esse limite pode resultar em menos empresas do que a meta. A busca automática por recortes complementares de CNPJ continua pendente.

## Verificação

- A integração HTTP → Postgres → worker comprovou a ordem das consultas, o descarte de um homônimo, a continuação no próximo lote, a rejeição de google.com, a retomada de uma página após timeout e a repetição da confirmação sem novos jobs. O Chrome real executou JavaScript em páginas de teste interceptadas localmente. CNPJ, Maps e busca web foram simulados. O teste de navegador indisponível confirmou zero disparos antes de voltar.
- A reconciliação testou um run de Maps cuja resposta inicial ficou incerta. O administrador vincula o run ao perfil certo. Com a mesma revisão ainda válida e o autor original, a jornada continua do ponto interrompido sem repetir o disparo.
- O Chrome testou o Gerador em 1920×855 e 390×844. A rodada de revisão de saldo e CNAE passou com zero resíduos e sem confirmar a busca. Capturas locais em `output/playwright/registry-first/`. O Gerador foi consultado nas capturas armazenadas do CadenceFlow. O diálogo da jornada combina regras próprias do Prometeus e não tem estado equivalente nessa referência.
- Os 460 testes unitários passaram. A suíte de integração registrou 685 aprovados, zero falhas e 5 casos reais de Stripe desabilitados. Build e typecheck passaram. O verificador da base repetiu apenas os quatro erros históricos de clone/barriers.md. O auditor global registrou 8/138 com os relatórios de UI anteriores fora do hash atual. A validação visual desta rodada cobre o diálogo de revisão.

A migração da fila foi exercitada em bancos efêmeros. O navegador autenticado no runtime compartilhado, o corte do provedor legado e o piloto pago ficam nas etapas seguintes. A rodada usou zero créditos da Apify e nenhuma mensagem externa.

[Contrato de entrada do Actor de CNPJ](https://apify.com/bigdavidson/brazil-cnpj-companies/input-schema)
