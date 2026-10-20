# Superfícies e cobertura

Legenda: **O** = conteúdo observado no Chrome; **F** = formulário aberto sem salvar; **P** = print do usuário; **R** = apenas rota/navegação ou cliente estático. Os estados da conta não permitem validar todos os comportamentos.

| Rota | Cobertura | Conteúdo |
| --- | --- | --- |
| `/login` | P + REA público | Autenticação e Google OAuth |
| `/dashboard` | O, P | Indicadores, onboarding, gráficos, funil |
| `/contacts` | O, P | Lista, busca, filtros, colunas |
| `/leads/:id` | O | Perfil, qualificação, dados empresariais, histórico |
| `/leads/generator` | F | Maps, web, CNPJ, Apollo; filtros CNPJ examinados |
| `/leads/qualifier` | F | Lista, seleção e módulos de qualificação |
| `/leads/enrich` | O | Elegibilidade, crédito e cache de decisores |
| `/cadences` | O | Estados e métricas da lista |
| `/cadences/:id` | O, F, P | Canvas, nós e regras; conteúdo completo de Saúde ainda não levantado |
| `/cadences/new` | R | Entradas de criação |
| `/cadences/new/ai` | F | Objetivo, lista, tom, ritmo e três etapas |
| `/cadences/pipeline` | O | Seletores e estado sem cadência selecionada; colunas preenchidas não examinadas |
| `/templates` | O, F | Biblioteca vazia e formulário com variáveis e preview |
| `/executions` | R | Navegação observada; detalhe não examinado |
| `/automations` | P | Lista agrupada e filtros |
| `/automations/new` | F | Cinco etapas manuais, sem confirmação final |
| `/automations/new/ai` | O, P | Resultado existente; entrada e três propostas nos prints; contratos estáticos |
| `/linkedin/dashboard` | O | Fluxo de entrada e requisitos de plano |
| `/linkedin/campaigns`, `/linkedin/people`, `/linkedin/pipeline` | R | Rotas observadas no DOM |
| `/linkedin/enrichment`, `/linkedin/approvals`, `/linkedin/cadences`, `/linkedin/templates` | R | Rotas observadas no DOM |
| `/inbox` | O | Recebidos/enviados e filtros, conta sem canais |
| `/messages/whatsapp` | P + R | Estado desconectado e contratos de conversas no cliente |
| `/reports` | O | Métricas e quatro séries de gráficos |
| `/reports/funnel`, `/reports/negocios`, `/reports/performance` | R | Navegação observada; detalhes não examinados |
| `/sdr` | R, P | Item de navegação e indicação de upgrade |
| `/first-steps` | R, P | Checklist e passeio contextual |
| `/settings`, `/settings/account` | O | Perfil, fuso, cobrança, avisos e resumos |
| `/settings/context` | O | Leitura do site, revisão, aprovação e produtos |
| `/settings/whatsapp` | O | Meta, QR e Z-API; conexão não executada |
| `/settings/email` | O, F | Vazio e bloqueio de conexão pelo teste inativo |
| `/settings/dispatch-limits` | O | Tetos e estados sem canais |
| `/settings/plan` | O | Plano, cotas, adicionais e comparação |
| `/settings/apps` | O | CRM, Google Planilhas e Apollo |
| `/settings/notifications`, `/settings/seats`, `/settings/security` | R | Links e candidatos estáticos; formulários não examinados |
| `/settings/mcp`, `/settings/dados`, `/settings/privacy`, `/settings/webhooks` | R | Links e candidatos estáticos; fluxos não exercitados |

O número de rotas inventariadas não é uma medida de percentual de conclusão do clone.
