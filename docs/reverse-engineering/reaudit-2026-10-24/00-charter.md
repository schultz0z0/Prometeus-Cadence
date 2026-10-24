# Charter: CadenceFlow

Date: 2026-10-24. Mode: attended. Environment: L4 observe only.

## Goal
Auditar novamente todas as superfícies acessíveis do CadenceFlow, comparar visual, fluxo, funcionalidades, regras, permissões e planos com o Prometeus Cadence e revisar os marcos restantes. A auditoria passa a integrar o marco06. Meta: paridade verificável por caso, sem inferir backend privado ou declarar100% com cobertura incompleta.

## Decisions from the user
- Mudança OpenWA aceita; próximo marco autorizado.
- Stripe em ambiente de teste.
- Mensalidade com pacotes adicionais pré-pagos.
- Planos/pacotes da referência podem ser reproduzidos; registrar preços e condições observados antes de configurar catálogo. Não autoriza compras ou assinaturas na referência.
- Preservar arquitetura própria, marca Prometeus e infraestrutura própria.
- Novos marcos para corrigir ou melhorar áreas anteriores foram autorizados explicitamente pelo usuário em24/10.

## Scope
Dashboard/onboarding, leads/listas/geração/enriquecimento/qualificação, cadências/pipeline/templates/execuções, automações/IA/contexto, mensagens, LinkedIn, SDR, relatórios, todas as configurações, segurança/permissões, planos/pacotes/cobrança e integrações/API/MCP.

## Method
RES orienta inventário e evidência UI. REA apoia análise estática parcial de4 arquivos entre36 artefatos públicos observados, sem executar código do alvo. Histórico em ../FINDINGS.md e ../SURFACE-MAP.md permanece evidência anterior, não revalidada por definição. Mercado Brasil/B2B é premissa do projeto. Termos consultados: https://cadenceflow.pro/termos, seção8 restringe cópia e engenharia reversa [doc SRC-002]. A decisão cabe ao usuário; a implementação será própria, sem transplantar código/identidade/textos do produto.

## Boundaries
Nenhuma compra, teste pago, envio, convite, conexão externa ou alteração persistente de dados/configuração na referência. Telas/estados bloqueados entram na matriz com o impedimento. Não contornar permissões ou plano.
