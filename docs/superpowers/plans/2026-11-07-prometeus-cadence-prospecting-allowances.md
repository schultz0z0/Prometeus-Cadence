# Franquias de captação e qualificação

> **Execução:** aplicar a skill de execução de planos e seguir as tarefas com TDD e revisão independente. O usuário aprovou o plano de limites e confirmou o teto separado para os créditos adicionais.

**Objetivo.** Tornar utilizáveis e visíveis as franquias do Essential e do Pro no Gerador e no Qualificador.

**Arquitetura.** O catálogo define os limites comerciais. O banco reserva e liquida o consumo com os registros de cobrança e de execução já existentes. A revisão consulta a mesma política aplicada na confirmação. A capacidade dos provedores tem controles operacionais próprios.

## Referência e escopo

- [EV-004](../../reverse-engineering/reaudit-2026-10-24/evidence/EV-004-plan-catalog-monthly.txt) registra 5.000 extrações no Essential, 8.000 no Pro e qualificação com IA e extração profunda. [EV-024](../../reverse-engineering/reaudit-2026-10-24/evidence/EV-024-lead-generator.txt), [EV-231](../../reverse-engineering/visual-2026-10-25/evidence/EV-231-generator-ref.json) e [EV-253](../../reverse-engineering/visual-2026-10-25/evidence/EV-253-qualifier-ref.json) registram os fluxos e controles para comparação visual.
- O adicional observado na referência é recorrente. O Prometeus preserva a escolha por créditos pré-pagos sem vencimento. As evidências consultadas não estabelecem os tetos diários da referência.
- LinkedIn e Agente SDR ficam fora do pacote. Apollo mantém a classificação atual de importação. Enriquecimento tem unidade comercial própria. O teste de 7 dias e as demais capacidades de cobrança seguem as regras existentes.

## Regras de uso

| Plano | Extrações incluídas por ciclo mensal | Extrações incluídas por dia | Qualificações incluídas por dia |
| --- | ---: | ---: | ---: |
| Essential | 5.000 | 250 | 250 |
| Pro | 8.000 | 400 | 400 |

O teto diário é a franquia mensal dividida por 20. Em cada busca com o plano, o saldo efetivo é o menor entre o saldo diário e o saldo mensal, descontadas as reservas em aberto. Usar 4.000 extrações no Essential deixa 1.000 até a renovação. Na renovação ficam disponíveis 5.000 no novo ciclo, inclusive quando a assinatura é anual. Proposta de relógio para o teto diário: meia-noite em America/Sao_Paulo, com próxima renovação visível na interface. O ciclo mensal usa a janela de cobrança.

O Gerador oferece duas opções explícitas. **Usar franquia do plano** é o padrão e reserva somente a franquia incluída. **Usar créditos adicionais** reserva somente o saldo pré-pago. Sem débito automático de um saldo para o outro. Somente workspaces com Essential ou Pro ativo podem comprar adicionais. Validar a elegibilidade também no servidor de cobrança. Ao perder o plano ativo, preservar créditos comprados para uso quando houver assinatura elegível novamente.

Os créditos adicionais têm teto diário separado, de 250 no Essential e 400 no Pro, limitado pelo saldo comprado. Assim, é possível processar até 500 ou 800 extrações no dia usando as duas modalidades. Qualificar leads extraídos por créditos usa uma capacidade diária adicional equivalente, vinculada à origem registrada do lead, sem novo débito de extração. Leads anteriores ou importados podem entrar pela capacidade incluída. Qualificações avulsas, automações e a jornada integrada compartilham a capacidade correspondente no workspace. Para a qualificação incluída, dimensionar pelo teto diário e não atrelar a seleção à data de captação.

Na geração, reservar pelo máximo solicitado e debitar pelos leads novos inseridos, seguindo o contrato atual. Duplicados, rejeitados e capacidade não usada liberam saldo comercial. As execuções externas efetivamente realizadas continuam registradas. Na qualificação, reservar pelos contatos selecionados e definir a liquidação por lead efetivamente processado, incluindo resultados sem aderência. Pulos sem processamento liberam reserva. Repetir uma requisição idempotente não gera nova cobrança. Uma nova análise deliberada usa capacidade novamente.

## Contrato da Prospecção completa

O fluxo começa no Maps e separa captação validada de qualificação comercial. Este contrato detalha a Prospecção completa. A eventual extensão dos mesmos requisitos para a busca avulsa de cada fonte é uma decisão separada.

**Captação**

1. Pesquisar termo e localização no Maps via Apify, em lotes, com paginação ou consultas complementares dentro da região solicitada. Preservar nome, categoria, endereço, telefone, link da ficha, nota, quantidade de avaliações, status e links encontrados. Mostrar nota e quantidade no preview quando presentes. Usar avaliações como sinal de prioridade sem nota mínima arbitrária. Horário fechado não equivale a encerramento. Excluir estabelecimentos confirmadamente encerrados e deduplicar por ficha e identidade cadastral, preservando a identidade de filiais.
2. Exigir nome, telefone com formato válido, site institucional verificável e CNPJ ativo vinculado à empresa. Se a ficha não trouxer o site, buscar via Apify e avaliar vários resultados. O Instagram pode fornecer pistas para chegar ao site, sem substituí-lo neste fluxo. Guardar e-mail, Instagram e indicação comprovada de WhatsApp quando disponíveis. Um número de celular sozinho não comprova WhatsApp.
3. Rastrear as páginas públicas relevantes do domínio institucional via Apify, com descoberta por sitemap e links internos, prioridade para rodapé, Contato, Sobre e páginas legais, e limites de páginas, tempo e custo. Extrair CNPJs candidatos, verificar dígitos e confrontar a identidade com o site e a ficha do Maps. Consultar o cadastro via Apify para confirmar vínculo e situação ativa e coletar razão social, CNAE, porte, dados cadastrais e quadro societário quando retornados. Guardar número de funcionários apenas quando uma fonte sustentar o valor ou a faixa. Preservar o cargo registrado de cada sócio ou administrador.
4. Continuar até atingir a quantidade pedida, esgotar os resultados úteis ou atingir o orçamento técnico previamente revisado. Candidatos rejeitados, repetidos ou sem comprovação não contam como entregas nem consomem franquia comercial. Se o cliente pedir 100 e só houver 72 verificadas, entregar 72, devolver a reserva restante e mostrar o motivo do resultado parcial. Registrar separadamente o uso externo das tentativas.

**Qualificação**

1. Receber a empresa captada com seus fatos e fontes. Investigar perfis comerciais e atividade recente no Instagram e Facebook e considerar evidências públicas indexadas de empresa e pessoas no LinkedIn. Preservar a restrição de nenhuma chamada direta ao LinkedIn. Investigar perfis profissionais de sócios e administradores identificados no cadastro, com cruzamento de identidade para evitar homônimos. Guardar o papel cadastral e a evidência do papel comercial em separado.
2. Avaliar aderência aos critérios do usuário com fatos verificáveis. Distinguir aderente, fora do perfil e evidência insuficiente, com justificativa e fontes. Reusar dados coletados na captação. O aplicativo orquestra a Apify e valida os requisitos de admissão. A IA pode orientar consultas, extrair informações e avaliar aderência com referências, respeitando limites e sem promover conteúdo das fontes a instruções.

## Implementação e aceite local

1. O Qualificador avulso examina até cinco resultados de busca, rejeita buscadores e diretórios e valida a identidade nas páginas antes de propor um site. A descoberta vem antes da consulta cadastral. A qualificação usa a ficha do Maps quando faltam páginas do site e reaproveita fontes de investigações vinculadas à mesma empresa. A busca social faz parte da investigação da empresa na Prospecção completa.
2. A Prospecção completa examina até duas vezes a quantidade pedida, com teto de 500 candidatos e dois lotes Maps. O segundo lote usa o termo com a localização solicitada. Cada candidato pode disparar uma busca por site, até seis rastreamentos e uma consulta cadastral. O crawler configurado lê até dez páginas por domínio, limitado também por profundidade, concorrência e tempo. A rodada local com coleta simulada usa o mesmo contrato de admissão. O coletor direto limitado permanece disponível quando o Actor de site não está configurado.
3. O sistema exclui estabelecimentos explicitamente encerrados. Conserva os fatos do Maps, a evidência institucional e a cadastral. Sem site próprio e CNPJ ativo confirmado, o candidato não vira entrega. O teto comercial é o solicitado e o saldo não usado volta para sua origem. A investigação usa resultados sociais corroborados e lê LinkedIn apenas pelo buscador. As propostas ficam sujeitas a revisão humana.
4. A migração 113a implementa a reserva e liquidação por saldo de extração. A 113b separa as vagas diárias de qualificação conforme a origem da captação. A 113c valida a elegibilidade na compra de pacotes e a janela mensal de assinaturas anuais. A 113d separa os orçamentos técnicos de trial, planos pagos e análises auxiliares e respeita a política operacional vigente.
5. Meu plano e o catálogo mostram os tetos diários. O Gerador e a Prospecção completa permitem escolher o saldo. O Qualificador mostra a disponibilidade por origem, e a revisão agrupa chamadas de mesmo provedor e unidade. A confirmação revalida os saldos e reservas no banco.

## Dimensionamento local

Para um teto diário D, o pior caso modelado tem 2D entregas nas duas modalidades. Em buscas unitárias, a reserva por entrega comporta dois lotes Maps, até dois candidatos com oito chamadas cada, até três chamadas para pesquisa, três para decisores e duas para o Qualificador. Isso dá 52D execuções Apify, ou 13.000 no Essential e 20.800 no Pro. São unidades técnicas máximas de reserva para suportar o fluxo. Os fornecedores podem impor suas próprias cotas e preços.

A capacidade diária reserva até 8D chamadas convencionais por provedor e até 4D decisões JEV, com o consumo registrado por unidade. Sugestões de público e outras análises auxiliares compartilham um orçamento separado de 20 chamadas diárias por unidade de IA. Essa política local foi escolhida para preservar a capacidade principal. O orçamento global pago deriva da soma dos planos ativos. A homologação pública precisa de um teto de operação sustentado por medições de custo e concorrência.

O [relatório](../../validation/2026-11-07-prospecting-allowances-progress.md) reúne os resultados e as lacunas da validação. A [revisão](../../validation/2026-11-07-prospecting-allowances-review.md) descreve as regressões corrigidas. O aceite público exige uma rodada real de captação até qualificação, com custo por lead, cobertura das fontes e concorrência. O aceite integral do 08A e a operação pública do 08B têm registros próprios.
