# Auditoria do escopo final e proposta de subdivisão —27/10/2026

**Estado: proposta aprovada expressamente pelo operador em 27/10/2026 e incorporada ao roteiro geral.** A aprovação cobre escopo, subdivisões e prioridades do desenvolvimento completo. Não declara os novos pacotes implementados; seus planos executáveis serão detalhados por entrega.

## Conclusão

**Consolidação posterior 27/10:** a pedido expresso do operador, todos os pacotes restantes receberam planos técnicos antes da retomada da implementação. Consultar [PRD completo](2026-10-27-prometeus-cadence-complete-prd.md) e [índice mestre](../plans/2026-10-27-prometeus-cadence-master-plan.md). A indicação anterior de detalhamento futuro descreve a situação anterior a essa consolidação.

O roteiro cobre as grandes áreas, mas não explicita toda a cadeia de investigação solicitada pelo operador nem seus aceites intermediários. A expressão “dados de decisores” do 06B.2 é insuficiente para representar Maps → site/redes → identidade empresarial/CNPJ → sócios/gestores → perfis pessoais → contatos atribuídos → qualificação → cadência revisada. Não declarar o planejamento integralmente detalhado nem considerar essa cadeia encerrada pelos aceites existentes.

Esta revisão usa os documentos e evidências já existentes; não houve nova varredura ao vivo, contratação, instalação, chamada paga ou envio. Reaproveita a metodologia RES de separar observação, inferência e contrato próprio, e as limitações das evidências REA anteriores. Não afirma conhecer o backend privado do CadenceFlow.

Fontes locais:

- [Roteiro vigente](../plans/2026-10-20-prometeus-cadence-roadmap.md), incluindo continuidade 06IA e barreira 07A.
- [Fechamento de paridade aprovado](../plans/2026-10-26-prometeus-cadence-parity-closure.md).
- [Aceite limitado do 06B.2](../../validation/06-qualification-enrichment.md): busca pública de decisores, sem Actor LinkedIn dedicado, contato pessoal não garantido.
- [Aceite 06IA](../../validation/06-platform-ai.md): administração central e contexto privado, sem piloto pago de acurácia.
- [Estado da auditoria visual](../../reverse-engineering/visual-2026-10-25/STATUS.md): evidências parciais e estados não observados preservados.

## Contrato de produto a tornar explícito

1. **Prospecção principal:** usuário informa nicho/local/objetivo; sistema investiga empresas e pessoas, qualifica e propõe mensagens/cadência editáveis. Pesquisa no LinkedIn como fonte de dados pertence a esta cadeia, sem depender de uma conta LinkedIn conectada quando a fonte utilizada não a exigir.
2. **Módulo LinkedIn:** relacionamento comercial pela identidade conectada do cliente: público, campanhas, convites/aceites e conversas/pipeline conforme capacidades efetivamente concedidas. Não pressupõe gerenciamento editorial completo do perfil. OAuth não demonstra permissão para automatizar mensagens.
3. **SDR:** atendimento conversacional opcional com contexto, horários, qualificação, agenda e passagem para humano. Receber resposta interrompe a cadência; não ativa automaticamente um SDR que o cliente não configurou/autorizou.

Apify, LLM e instruções gerais são infraestrutura administrada pelo dono do SaaS. Dados, contexto, pedidos, resultados, consumo e canais pertencem ao workspace cliente. Ampliar fontes não autoriza expor chaves ou seleção de infraestrutura aos clientes, nem compartilhar resultados privados entre empresas.

## Novos pacotes aprovados

Manter os IDs/aceites anteriores como histórico. Os nomes abaixo são extensões aprovadas; os planos executáveis serão escritos por pacote, sem reconstruir jobs, quotas ou IA já aceitos.

| Pacote proposto | Entrega e fronteira de aceite |
|---|---|
| **06B.3 — Investigação da empresa e redes** | Maps e fontes existentes como entradas; descobrir/conferir site e perfis da mesma empresa; pesquisar contexto e contatos comerciais. Ampliar fontes Apify quando justificadas. Registrar URL, data da coleta, atribuição, conflitos e ausências. Testar empresas sem site, perfis incorretos, páginas indisponíveis e resultados parciais. |
| **06B.4 — Identidade e tomadores de decisão** | Resolver CNPJ/razão social com evidência; relacionar sócios, empresa e gestores não sócios; buscar empresa/pessoas no LinkedIn e nas fontes úteis; distinguir homônimos, vínculo atual/incerto e contato corporativo/pessoal. Resultado revisável, com origem por campo e motivos de abstenção. Não deduzir titularidade ou WhatsApp ativo de um número encontrado. |
| **06B.5 — Jornada integrada de prospecção** | Orquestrar investigação, qualificação e resultado sem exigir que o cliente monte a cadeia de APIs. Mostrar progresso, cancelamento/retomada, consumo, falhas parciais e o que faltou encontrar; evitar repetir consultas/cobranças. Entregar lista revisável e sugerir cadência de WhatsApp/e-mail com variáveis e contexto, usando autoria/publicação de 06D; nenhuma proposta dispara mensagens. |
| **06IA-H — Homologação da inteligência e das fontes** | Validar com conjunto de empresas/cenários controlados: pertinência, cobertura, atribuição dos contatos, homônimos, custo e tempo por etapa. Comparar contratos dos Actors com dados realmente entregues e saídas da LLM/JEV. Fixar critérios mensuráveis antes do piloto; instruções versionadas e isolamento existentes são reaproveitados. Ajustar apenas o que a avaliação demonstrar necessário. |

A cadeia é adaptativa: uma etapa sem resultado não deve interromper todas as demais nem ser preenchida com dados inventados. Não há promessa de encontrar celular pessoal de toda empresa. A UI precisa distinguir “encontrado com fonte”, “atribuição incerta”, “não encontrado” e validação efetivamente realizada pelo canal.

## Apify: ampliação administrada de fontes

Incluir no escopo a capacidade de acrescentar fontes úteis de sites/redes sociais. Não tratar “todas as redes” ou “todo Actor da loja” como integração já contratada e operacional.

Para cada fonte escolhida no desenho do pacote, registrar: finalidade na jornada; campos de entrada/saída; acesso necessário; cobertura; custo e teto; versão/build; frequência; falhas; rastreabilidade; descarte/retenção e alternativa quando indisponível. Administrador controla credenciais, habilitação e orçamento; o workspace vê apenas opções de produto que realmente funcionam.

A seleção de Actors concretos será feita com consulta ao acervo O Setup quando o servidor estiver disponível, documentação do fornecedor e piloto controlado. Nenhuma ferramenta nova é recomendada por este documento. Testes com consumo pago precisam de orçamento definido, separado dos créditos comerciais do cliente. Limites globais do fornecedor e limites por workspace devem coexistir para um cliente não consumir toda a capacidade.

## Divisões dos marcos futuros

| Área | Refinamento recomendado |
|---|---|
| **06D** | Manter 06D.1 autoria/variáveis/versões/anexos/revisão/publicação e 06D.2 canais/inbox/entrega/parada. Vincular a proposta da prospecção aos mesmos contratos, sem editor ou fila paralelos. |
| **07A** | Extrair **07A.0** de viabilidade/permissões antes de prometer execução; **07A.1** conexão/saúde/sincronização; **07A.2** público/campanha/convites/aceites; **07A.3** conversas/pipeline/cadências/aprovações. Cada ação depende de capacidade comprovada. Fluxos que o provedor não permitir exigem decisão explícita de contrato ou conector; não os marcar concluídos por terem UI. |
| **07B** | Separar **07B.1** configuração/conhecimento/horários/regras; **07B.2** conversa/memória/qualificação/limites/intervenção humana; **07B.3** agenda/CRM/follow-up e piloto. Posicionar como último módulo funcional novo, após operações e integrações de que depende. |
| **07C** | Manter contratos, conectores e MCP existentes no roteiro; identificar para cada integração se é infraestrutura central ou conta do cliente. Agenda/CRM operacionais antecedem o piloto SDR. |
| **06C/08A/08B** | Métricas reconciliam os novos eventos; regressão percorre jornadas completas; liberação pública exige isolamento, concorrência, limites/custos, recuperação, backup/restauração e comportamento real desktop/mobile. Aceite local não equivale a carga pública homologada. |

## UI/UX como parte de cada entrega

Preservar a experiência de referência e as divergências aprovadas: trial 7 dias, consumo adicional pré-pago e OpenWA gerenciado. Não substituir a interface atual por um painel técnico de fontes/Actors.

Cada item do inventário deve ligar **tela/estado/controle → ação permitida → operação real → estado persistido → evento/métrica → feedback ao usuário → teste/evidência**. Cobrir vazio, sucesso, andamento, erro, resultado parcial, limite, permissão e recuperação, incluindo popups e mobile. A interface nunca pode mostrar uma configuração como aplicada quando o executor não a utiliza.

Aceite transversal: partir de pedido de prospecção, chegar a empresas/pessoas revisáveis, editar uma sugestão de cadência, publicar conscientemente, acompanhar execução/entrega disponível, receber resposta, interromper follow-up e assumir atendimento humano ouSDR configurado. Lista, inbox, dashboard e relatórios devem refletir os mesmos fatos, respeitando permissões e quotas. Pilotos de envio usam somente canais/destinatários próprios autorizados.

## Sequência aprovada para adoção

Primeiro incorporar ao roteiro a cadeia detalhada, a matriz de UI/UX e as dependências. Em seguida executar 06B.3 e 06B.4 em pacotes pequenos; manter 06D.1/06D.2 para autoria/canais e fechar 06B.5 com esses contratos. Homologar as fontes/inteligência em 06IA-H antes de aceitar a jornada principal completa. A viabilidade 07A.0 pode ser investigada cedo para antecipar limitações externas. Os demais pacotes seguem suas dependências; SDR fica ao final das funcionalidades, antes da regressão/liberação comercial e operacional finais.

Essa atualização altera a próxima prioridade para 06B.3, antes do 06D.1 anteriormente registrado. Não reabre os aceites anteriores nem transforma estados da referência não observados em prova de paridade. O roteiro geral conserva as famílias 01–08:06B.3/4/5 são subdivisões do 06, não substituem 07 e 08. O roteiro vigente encerra em 08B; não existe 09 definido nesta revisão.
