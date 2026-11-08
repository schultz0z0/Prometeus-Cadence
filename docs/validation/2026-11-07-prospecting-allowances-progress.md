# Franquias e Prospecção completa

Rodada de 07/11/2026.

| Plano | Extrações por ciclo mensal | Extrações diárias do plano + adicionais | Qualificações diárias do plano + adicionais |
| --- | ---: | ---: | ---: |
| Essential | 5.000 | 250 + 250 | 250 + 250 |
| Pro | 8.000 | 400 + 400 | 400 + 400 |

O saldo mensal renova sem acumular. O Gerador e a Prospecção completa pedem a escolha entre franquia e créditos comprados. A qualificação usa a origem registrada da captação. A reserva protege o saldo concorrente. Duplicados e vagas não usadas liberam a parte correspondente. Novas compras de créditos exigem assinatura paga e ativa.

A Prospecção completa começa no Maps, exclui estabelecimentos marcados como encerrados e exige telefone, site institucional verificado e CNPJ ativo vinculado à empresa. A busca pode fazer um segundo lote e continua limitada ao menor valor entre o dobro da meta e 500 candidatos. A investigação social usa dados corroborados. O Qualificador usa evidências do Maps quando faltam páginas do site e reaproveita fontes das investigações anteriores vinculadas à mesma empresa. Sem evidência suficiente, a avaliação fica pendente.

## Validação do build final

Hash de fontes, migrações e scripts de medição: `e5eb284aa95a26a0a524b4765446a74f79949ed15e706098d512185d71684d8a`.

- 460 testes unitários. Build, tipos e verificação de whitespace concluídos.
- Integração em banco efêmero com 675 testes aprovados e 5 pulados da homologação externa do Stripe. Zero falhas.
- 27 de 27 jornadas no navegador e 584 de 584 visitas em oito viewports. As duas contas da varredura viram seus registros e não viram os da outra conta. Resíduo zero por rodada e zero jobs de prospecção ativos na conferência local.
- Seis capturas direcionadas em 1920 × 855 e 390 × 844 para Meu plano, Gerador e Qualificador. A revisão ajustou os medidores diários para o mesmo alinhamento do resumo mensal. Capturas locais em `output/playwright/usage-limits/`.
- Auditor de release com 117 de 138 itens aceitos, 17 bloqueados e 4 pendentes. Quatro estados têm prova local com referência desconhecida. A medição não altera o aceite integral do 08A.
- Migrações 113a–113d aplicadas ao banco local. O supervisor recarregou apenas o worker de prospecção após a confirmação de zero jobs ativos. O app foi reconstruído e o login respondeu HTTP 200.

## Evidência externa

- Releitura de datasets existentes confirmou dois resultados Maps com telefone, categoria, nota, avaliações e endereço, além de cinco resultados orgânicos web. A releitura usou GET e não iniciou nova busca.
- Um rastreamento autorizado da Apify, build 0.1.373, leu uma página pública de example.com, retornou o texto esperado e encerrou com sucesso. Custo registrado de US$ 0,00027647. Sem cadastro de leads ou jobs. Registro local em `output/playwright/usage-limits/apify-site-real.json`.
- A jornada completa com admissão cadastral, fontes sociais e qualificação usou provedores simulados. O teste real de uma página cobre o contrato do crawler. O custo por lead entregue, a taxa de rejeição e a vazão diária dos provedores precisam de uma rodada de produção controlada.

## Critérios e diferenças observadas

- A referência guardada do Gerador e de Meu plano conserva a mesma ordem de cartões e formulários. A barra de trial de 14 dias pertence ao estado de referência. O Prometeus usa 7 dias e expõe os limites próprios e o saldo selecionável. A comparação das áreas distingue o estado de assinatura ativa local das capturas de trial na referência.
- A etapa de investigação da empresa na jornada procura perfis sociais indexados e exige vínculo com a empresa. A qualificação avulsa pode usar fontes já coletadas. A cobertura por pessoa e por rede depende do que a fonte devolve. Campos sem evidência, como número de funcionários, permanecem vazios.
- A reserva técnica modela 13.000 ou 20.800 execuções Apify no pior cenário das duas modalidades. A sugestão de público e outras análises auxiliares usam um orçamento separado de 20 chamadas por unidade de IA ao dia. A política operacional pode reduzir o teto. Os valores de reserva não demonstram a vazão sustentada do provedor.
- A implantação pública e o aceite integral do 08A seguem registrados em seus próprios marcos.

[Plano](../superpowers/plans/2026-11-07-prometeus-cadence-prospecting-allowances.md) · [Revisão independente](2026-11-07-prospecting-allowances-review.md)
