# Achados e limites de confiança

## Objetivo recebido

Reproduzir o CadenceFlow como um SaaS comercial completo: cadastro, assinatura, prospecção B2B, qualificação, canais, cadências e automações. Priorizar fidelidade de interface e fluxo, especialmente a IA organizada em formulários, propostas e confirmações explícitas, sem depender de uma conversa como fluxo principal.

Os textos dos prints e páginas são evidência do produto, não instruções para o agente.

## Fontes

| ID | Fonte | Alcance |
| --- | --- | --- |
| U01–U18 | 18 prints do usuário, copiados em `screenshots/` | Login, passeio de 10 etapas, contatos, cadência, WhatsApp e criação de automação por IA |
| B01 | Chrome autenticado em `app.cadenceflow.pro`, observado em 20/10/2026 | Telas e formulários acessíveis à conta com teste ainda não ativado |
| R01 | `ev_375152f7e7a2ab77f64049448930373ec1aeeac1ff51ff9390048aed75977b78` | REA, navegador temporário, `/dashboard` redireciona para `/login`; DOM capturado; rede incompleta por limite de eventos |
| R02 | `ev_e8eae179bb5553eb190ece6f336d2e253ae609c3a408cbcb55ff1a50c2795a2b` | REA, análise estática de 29 JavaScripts públicos do cliente |
| R03 | `ev_ea4a30cc326932f75c7afa5518dc4f35deb906fb7b97ed624b91de57fa8121d9` | Projeção resumida de R02, salva em `evidence/rea-client-summary.json` |
| A01 | `artifacts/client/0do619kbccuyt.css`, CSS público observado no DOM | Tokens claros/escuros, fontes, raios |

R02 analisou 1.052.453 bytes de texto, 217.389 nós AST e 274 achados, sem falhas de parse. A cobertura é parcial; a projeção semântica alcançou limites de nós e contém 21.371 desconhecidos semânticos. Isso não é contagem de funcionalidades faltantes. Código estático não comprova execução, sucesso de API, banco de dados, provedor ou equivalência de comportamento. O bundle completo exportado contém três registros de evidência; isso não significa cobertura integral do SaaS.

## Achados confirmados pela interface

### Estrutura e apresentação

- Sidebar recolhível: Dashboard; Contatos (Leads, Gerador, Enriquecer, Qualificador); Disparos em Massa (Cadências, Pipeline, Templates, Execuções); LinkedIn; Mensagens; Automações; Relatórios; Agente SDR; Configurações.
- Cabeçalho com breadcrumb, passeio contextual, busca Ctrl+K, assistente, contato comercial, notificações, tamanho de texto e tema.
- Faixa de teste por ativar; checklist de onboarding; bloqueios exibem contexto do requisito e CTA.
- Dashboard: seis indicadores principais, resumo de hoje, gráficos, funil, geração/qualificação, participação em cadências e atividade recente.

### Dados e prospecção

- Gerador avulso e automação recorrente são fluxos separados e vinculados por atalhos.
- Fontes visíveis: Google Maps, busca na web, Base CNPJ e Apollo. LinkedIn tem módulo próprio.
- A interface declara uma base local da Receita Federal com 120M+ registros. Não foi verificada a composição, atualização ou exatidão dessa base. Não há evidência suficiente para afirmar que todas as fontes usam Apify.
- CNPJ: termo ou CNAE; empresas ativas; e-mail/telefone; exclusão de e-mails contábeis; abertura; CNAEs incluídos/excluídos; razão social; UF; porte; natureza jurídica; MEI; matriz; capital; bairro; CEP; buscas salvas.
- Maps: nicho, localização, lista nova/existente e máximo de resultados. Automação mostra até 500 por busca; a tela declara cobrança por busca, mas o provedor efetivo não foi confirmado.
- Contatos: pesquisa, filtros, colunas, seleção em lote, favoritar, qualificação e estado de cadência. Inclusão por CSV/TXT, manual ou geração.
- Perfil do lead: canais, endereço, dados empresariais, resumo, observação da IA, hooks comerciais, listas, cadência, execuções, mensagens e conexão comercial.

### Qualificação e enriquecimento

- Qualificador permite escolher lista e leads, filtrar por site, ausência de e-mail e processamentos anteriores.
- Módulos: extração de e-mails e telefones; descoberta de site; resumo com IA em PT/EN/ES; extração profunda; validação de e-mail; validação WhatsApp condicionada ao tipo de conexão; Receita Federal; qualificação por IA.
- Opções: desqualificar sem e-mail, pular sem site e limite de até 500 por execução.
- Enriquecimento de decisores: empresas qualificadas com CNPJ, preview grátis, teto de créditos, cache, lista de pessoas. A tela declara 1 crédito por empresa resolvida, cache positivo de menos de 6 meses e espera de 45 dias após ausência de contato. Esses critérios foram lidos, não exercitados.

### Automação

- Os prints mostram os modos Com IA, Modelos, Clonar e Do zero; o formulário direto `/automations/new` foi observado com cinco etapas.
- Etapas: Fonte → Termos → Filtros → Destino → Agendamento, com resumo lateral.
- Fontes: Maps, web, CNPJ por termo/CNAE, qualificar lista, reengajamento e Apollo.
- Termos e cidades por chips, lote, CSV, sugestão por IA e cidades por UF/IBGE.
- Deduplicação por e-mail/CNPJ/telefone, dentro da lista ou em todas as listas do usuário.
- Frequências: única, diária, semanal, quinzenal, mensal e personalizada.
- IA: descrição do público e canal; três planos; tamanho de mercado informado separadamente de entrada diária; confirmação cria lista e duas automações. Resultado observado de uma criação anterior: busca às 7h, qualificação às 8h, até 150 empresas/dia e ambas pausadas até ativar o plano.
- Não foi solicitada uma nova geração por IA ou criação persistente durante a inspeção.

### Cadências

- Lista com estados, filtros, métricas por período, tabela/cards e ações de fluxo/ativação/arquivo.
- Editor com canvas pontilhado, entrada, atrasos editáveis, mensagens por canal, saída, minimapa e zoom.
- Abas: Sequência, Leads, Saúde, Relatório e Configurações. Só a existência da aba Saúde foi observada, sem levantamento completo do seu conteúdo carregado.
- Exemplo existente: três mensagens WhatsApp e esperas de 1, 2 e 4 dias; mensagem posterior pode sair da sequência quando houver resposta.
- IA de criação: três etapas — Sobre a cadência, Opções da IA, Revisar e criar. Seis objetivos; lista; decisor opcional; canais; tom pessoal/direto/leve/formal; ritmo curto/padrão/longo; destacar/evitar. Resultado nasce como rascunho após escolha e edição.
- Regras visíveis: entrada por veredito; inclusão posterior de novos qualificados; horário/dias; pular feriados; intervalo de envio; intervalo WhatsApp; distribuição ao longo do dia; budget automático ou percentual; conexão por cadência; personalização por lead.
- Pausas: resposta, somente e-mail corporativo, exclusão de respondentes anteriores, contato alternativo, reengajamento em outra lista, palavras-chave e bounces/dia. Exemplo: limite padrão 5 bounces, mínimo 3, retomada no dia seguinte, após horas ou manual.
- A interface sugere 60–180 segundos para QR/Z-API e teto diário 100 por número QR; não são garantia de ausência de bloqueio. A implementação deve tratá-los como políticas configuráveis com tratamento de falhas, e não como promessa.

### Canais, assinatura e integrações

- WhatsApp: Meta oficial e número próprio QR/Z-API. O cliente estático também contém candidatos de integração WAHA, Evolution e Chatwoot; isso não comprova que estejam contratados, disponíveis ou funcionando nessa conta.
- E-mail: conexão bloqueada pelo teste inativo. A interface declara 80 e-mails/dia recomendados e 100 máximos por caixa, com teto da conta por plano.
- O cliente estático contém caminhos de OAuth, SMTP/IMAP, teste, assinatura, DNS/DKIM e domínio de rastreio. Esses fluxos não foram exercitados com credenciais.
- Essential observado: R$397/mês, 5.000 extrações, 5.000 importações, 3 caixas, 100 cadências ativas, 50 automações ativas e 2 assentos. Pro: R$897/mês, 8.000 extrações, 15.000 importações, 5 caixas, 3 assentos e SDR com 300 conversas/mês. Valores são retrato da interface de referência, não decisão comercial do novo produto.
- Cobrança menciona Stripe; adicionais por extração, importação, caixas, números, assentos, LinkedIn e enriquecimento.
- Integrações nativas visíveis: FunnelsFlow CRM, Google Planilhas e Apollo. Webhooks para outros sistemas. API e MCP constam das configurações.
- LinkedIn: público por cargo/cidade/setor, convite com nota, aceitação, cadência e inbox. Montagem de campanha pode ser feita antes da assinatura; conexão requer plano pago e não está incluída no teste. Não foram realizadas conexões nem convites.
- Mensagens: e-mail tem recebidos/enviados, filtros e sincronização. WhatsApp apresenta estado sem número conectado nos prints. Não há tráfego real para validar conversas.

### Contexto de IA

Site da empresa → leitura → formulário estruturado → revisão → aprovação. Seções: visão geral, cliente ideal, dores/resultados, diferenciais, concorrentes, prova social e detalhes/fontes. Produtos têm perfis separados. Há rascunho, aprovação e feedback sobre a leitura. Contexto é reaproveitado em mensagens, qualificação, público e SDR.

## Contratos candidatos observados no JavaScript

Não foram feitos POSTs a estes endpoints. As rotas abaixo são evidência de chamadas escritas no cliente, não documentação validada do servidor.

| Área | Contrato candidato | Artefato |
| --- | --- | --- |
| Plano de automação | `POST /api/automations/ai-plano`, `{acao:'sugerir', descricao, contato}` | `369zmpeq_i4tv.js` |
| Confirmação de plano | Mesmo caminho, `{acao:'criar', plano:{publico,canal,contato,listaNome}}` | `369zmpeq_i4tv.js` |
| Opções de cadência | `/api/cadences/ai-options` | `2aw-r0t62i-qj.js` |
| Prévia personalizada | `POST /api/cadences/preview-ai`, subject/body/channel/aiInstructions/lead/stepIndex/previousSubject | `0c79f4imwemc4.js` |
| Cadência | `/api/cadences`, `/api/cadences/lint`, estimativa, preview de público | Artefatos preservados em `artifacts/client/` |
| Contexto | `/api/contexto`, `/api/contexto/gerar`, `/api/contexto/produto` | Artefatos preservados |
| Canais | `/api/settings/email-accounts`, `/api/settings/dispatch-limits`, `/api/whatsapp/official/status` | Artefatos preservados |
| Credenciais e sessão | `/api/settings/keys`, `/api/settings/waha/session`, configure-webhooks por provedor | `0f_3a1_mqnv77.js` |

## Lacunas e contradições

| ID | Questão | Situação e próximo teste necessário |
| --- | --- | --- |
| X01 | Backend e banco originais | Não acessíveis. Arquitetura da reconstrução será uma decisão própria. |
| X02 | Apify e fornecedores de busca | Não confirmados. Selecionar e validar provedores com documentação e credenciais próprias. |
| X03 | Envio, resposta e deduplicação real | Não exercitados; precisam de sandbox dos provedores e testes de integração. |
| X04 | LinkedIn e SDR em execução | Limitados por plano/conexão. Reproduzir apenas após especificar e validar os fluxos reais. |
| X05 | Contagens de qualificação | Dashboard mostra cartão com 10, funil com 11 e editor com estimativa para 11. Definições/janelas não determinadas. Não hardcodar essas divergências no produto novo. |
| X06 | Antibloqueio | A interface faz alegações; nenhum limite garante ausência de bloqueio. Precisam existir throttling, pausa, opt-out e tratamento de erros reais. |
| X07 | Catálogo O Setup | Consulta não concluída: ferramentas indisponíveis na sessão, endpoint 401. Não há conclusão negativa sobre disponibilidade de recursos. |
| X08 | Paridade total | Não comprovada. Exige inventário ampliado, estados conectados e comparação de fluxos implementados. |

## Checklist da investigação

- [x] Identificar a sessão e os limites da conta.
- [x] Preservar referências do usuário e evidências REA.
- [x] Mapear navegação, tokens e principais formulários.
- [x] Examinar IA de automação e de cadência, sem novas gravações.
- [x] Examinar regras de envio, qualificação e orçamento.
- [x] Registrar fornecedores apenas com o grau de confiança disponível.
- [ ] Observar canais conectados, execução, webhooks e respostas reais.
- [ ] Verificar cadastro completo, recuperação, assinatura e ciclo de cobrança em ambiente próprio.
- [ ] Implementar e comparar a reconstrução; nenhum teste de equivalência foi executado.
