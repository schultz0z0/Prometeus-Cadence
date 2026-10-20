# Prometeus Cadence — especificação proposta

Data: 20/10/2026. Estado: **especificação aprovada pelo usuário em 20/10/2026; implementação não iniciada**.

Aprovação recebida: “Aprovar a especificação e seguir ao plano”. A autorização desta etapa é escrever o plano; sua revisão e o método de execução ainda serão apresentados.

## 1. Resultado esperado

Criar um SaaS comercial que reproduza a organização, a interface e os fluxos observáveis do CadenceFlow. Qualquer cliente deve conseguir criar conta, contratar um plano, configurar sua empresa, encontrar e qualificar empresas/pessoas, conectar canais e operar cadências e automações. Nome de trabalho: **Prometeus Cadence**, inferido da pasta; pode ser alterado sem afetar as regras.

A meta final inclui persistência, isolamento entre clientes, cobrança e integrações reais. Uma interface navegável isolada será um marco intermediário, nunca apresentada como SaaS integral concluído.

Referências: `docs/reverse-engineering/FINDINGS.md`, `SURFACE-MAP.md`, os 18 prints e as evidências REA. Comportamentos não observados são decisões propostas, não fatos sobre a arquitetura original.

## 2. Abordagem

Três abordagens foram consideradas:

1. Somente réplica visual: rápida para validar aparência, insuficiente como produto final.
2. **Reconstrução própria por módulos, com fidelidade de UX e contratos independentes:** permite verificar cada fluxo e conectar serviços reais progressivamente. É a abordagem proposta.
3. Tentar reproduzir o servidor original a partir dos bundles: não há evidência para recuperar sua arquitetura ou regras privadas com exatidão; isso deixaria lacunas ocultas.

Manter a estrutura de aplicação web observada no cliente e separar domínio, persistência, execução assíncrona e adaptadores de provedores. A escolha de novos recursos de skill/plugin/MCP depende da consulta pendente ao acervo O Setup. Não criar recursos equivalentes sem essa consulta.

## 3. Fidelidade visual

Preservar densidade de informação, hierarquia, menu na ordem do trabalho, breadcrumbs, tabelas, painéis, formulários, estados vazios e onboarding. Evitar redesenho criativo na primeira implementação.

Tokens medidos no CSS e no DOM:

| Token | Claro | Escuro (CSS) |
| --- | --- | --- |
| Primária | `#FF6B00` | `#FF8533` |
| Fundo | `#FAFAFA` | `#0C0E12` |
| Superfície | `#FFFFFF` | `#161A22` |
| Texto | `#111827` | `#F9FAFB` |
| Borda | `#E5E7EB` | `#2D323B` |
| Texto discreto | `#9CA3AF` | `#6B7280` |

Tipografia: Sora em títulos, Manrope no corpo e JetBrains Mono em trechos técnicos, conforme CSS entregue. Raios de 6/8/12/16px. Ícones lineares e ações laranja. Canvas pontilhado com linhas verticais, atrasos em pílulas, cartões de canal e minimapa.

Comparar capturas em viewport compatível com os prints do usuário e também em 1440px, 1280px e celular. Estados de carregamento, erro e vazio devem ter componentes específicos. Sidebar recolhida/aberta, tema e tamanho de fonte precisam funcionar. Sem gráficos e métricas falsamente apresentados como dados reais.

## 4. Módulos

### 4.1 Conta, workspace e cobrança

Cadastro, login, OAuth, recuperação, perfil, fuso e membros. Cada cliente tem workspace próprio, com papéis de proprietário, administrador e operador. Todas as consultas, mutações, arquivos, jobs e credenciais pertencem a um workspace.

Assinatura com estados de preparação, teste, ativa, pagamento pendente e cancelada. Entitlements e cotas ficam no servidor. A interface explica o requisito antes de permitir operação indisponível. Dados preparados não desaparecem quando o cliente precisa ativar o plano.

Configurar preços e limites próprios em catálogo versionado. Valores do concorrente servem como referência observada, não como decisão de preço. Cobrança por extrações/importações, assentos, caixas, números e enriquecimento deve ter ledger e auditoria, sem decremento duplicado por retries. Webhooks de cobrança são autenticados e idempotentes.

### 4.2 Contexto de IA

Domínio → leitura do site → perfil estruturado → revisão → aprovação. Perfis de empresa e produtos separados. Correções humanas prevalecem sobre releituras e ficam versionadas. Não inventar preços, clientes ou provas sociais ausentes da fonte.

O perfil aprovado alimenta público, qualificação e cadências. Se não houver contexto suficiente, mostrar o campo faltante e permitir continuar com modelos editáveis explicitamente identificados.

### 4.3 Leads e listas

Empresas e pessoas com identidade própria e vínculo entre decisor e empresa. Listas podem receber geração, importação, cadastro manual e automações. Campos incluem origem, CNPJ, nome/razão social, site, e-mails/telefones, endereço, CNAE, porte, sócios, resumo, qualificação, motivo e timestamps de obtenção/verificação.

Tabela com busca, filtros combináveis, colunas, ordenação, seleção em lote e perfil detalhado. Importação tem mapeamento de colunas, preview, validação e relatório de rejeições. Normalização de CNPJ, domínio, e-mail e telefone precede a deduplicação. Deduplicação respeita lista ou workspace e não mistura clientes.

### 4.4 Prospecção e qualificação

Interface avulsa para Maps, web, CNPJ e Apollo, com adaptadores independentes de extração. LinkedIn fica em módulo próprio. Seleção do provedor real não será deduzida do nome da fonte; Apify é uma possibilidade levantada pelo usuário, não uma dependência confirmada.

Cada execução exibe progresso real: preparada, na fila, executando, concluída, cancelada ou falhou. Mostrar encontrados, inseridos, duplicados, rejeitados, quota usada e erro acionável. Atualização incremental pode usar eventos ou polling enquanto o job está ativo.

Qualificação por módulos configuráveis e resultados separados: extração, descoberta do site, resumo, validação e veredito. Veredito com justificativa e fontes; falta de site ou contato não deve virar inferência inventada. Erros transitórios não equivalem a desqualificação.

Enriquecimento: preview de elegíveis, teto aprovado de créditos, fila, consumo somente em resultado faturável e pessoas em lista de destino. Cache inclui fonte e validade; critérios exatos são configuráveis e precisam de validação com o fornecedor escolhido.

### 4.5 Automação com IA e manual

Fluxo principal: público + canal → botão de análise → três propostas → detalhes/editáveis → confirmação → criação de lista e automações pausadas → atalho para criar cadência. Tamanho do mercado e limite diário são valores diferentes. Quantidade indisponível aparece como desconhecida; não fabricar contagens.

A análise e a criação são operações separadas. A proposta guarda versão, contexto e filtros utilizados. Confirmar uma proposta é uma transação idempotente: cria uma única lista e os jobs planejados, mesmo após clique duplo ou retry. Ativação ocorre em ação posterior explícita.

Formulário manual: fonte, termos, filtros/deduplicação, destino e agendamento. Frequência e timezone são persistidos. O agendador não depende de navegador aberto e evita sobreposição e duplicação da mesma janela. Pausar impede novas execuções; cancelamento de job ativo deve ter estado visível.

### 4.6 Cadências

Criação por IA, modelos, clonagem ou editor manual. IA recebe contexto aprovado, objetivo, lista, decisor, canais, tom, ritmo, destacar e evitar; retorna três sequências estruturadas. Revisão edita cada mensagem e salva rascunho. Nenhuma geração ativa envios.

Editor: entrada por lista/veredito, atrasos, etapas de e-mail/WhatsApp/LinkedIn, variáveis, instruções por etapa e saída. Separar definição versionada da sequência do estado de execução de cada lead. Versões publicadas não podem alterar retroativamente mensagens já enviadas.

Prévia usa um lead escolhido e identifica variáveis sem valor. A IA não deve tratar textos de sites ou leads como comandos. Preservar nome comercial, oferta e evidências corretas; não enviar texto com colchetes/variáveis não resolvidas sem revisão indicada.

Regras: dias/horários/fuso, feriados, intervalo por canal, distribuição no dia, limite/budget de canal compartilhado, elegibilidade por veredito, stop-on-reply, opt-out, supressão de respondentes anteriores, bounce e reengajamento. Resultado distingue resposta humana, resposta automática, abertura, clique, entrega e conexão comercial.

### 4.7 Execução multicanal

Workers com leases, retries limitados, backoff e chave idempotente por workspace/lead/cadência/etapa. Antes de cada tentativa verificar plano, credencial, conexão, aprovação, quota, janela, opt-out e estado de resposta. Após resposta/opt-out, cancelar próximos envios e revalidar imediatamente antes de enviar para evitar corridas.

Distribuir capacidade de uma caixa/número entre cadências no servidor; duas réguas não podem ultrapassar o limite agregado. Interrupção do worker não deve perder progresso. Timeout do provedor não é prova de falha do envio: usar reconciliação por identificador quando disponível e não repetir cegamente.

WhatsApp oficial usa o ciclo de templates/aprovações aplicável ao provedor. Número próprio deve ter QR/conectando/conectado/desconectado/erro, limites conservadores e pausa automática. Limites são redução de risco operacional, sem promessa de imunidade a bloqueio.

E-mail separa envio, recebimento, threading e rastreio. Credenciais são cifradas e nunca retornadas completas ao cliente. OAuth e SMTP/IMAP são conectores próprios. Testes de envio somente para destinatários de teste definidos.

### 4.8 Mensagens, LinkedIn, SDR e integrações

Inbox por canal com conversas, histórico do lead, não lidas, filtros, responsável e anexos. Respostas e falhas precisam atualizar a sequência correspondente de forma idempotente. Ações de envio manual devem exigir confirmação clara e registrar autor.

LinkedIn: campanhas por cargo/local/setor, preview, aprovação do convite, conexão do canal, aceites, sequência e enriquecimento. O funcionamento real depende de integração própria validada; não apresentar um botão conectado sem serviço funcional.

SDR é módulo separado e com ativação explícita por escopo; usa contexto aprovado e permite assumir atendimento, interromper e revisar comportamento. O pedido de controle humano prevalece: IA propõe alterações; criação, publicação e ampliação de escopo exigem confirmação. A recorrência só executa o que já foi aprovado e ativado.

Webhooks, API e MCP usam autenticação, escopos, limites e auditoria. Integrações CRM/planilhas mapeiam campos e eventos. Não copiar chaves nem depender da API privada do CadenceFlow para operar a reconstrução.

### 4.9 Relatórios e onboarding

Dashboard e relatórios derivam de eventos persistidos, com definição explícita de cada métrica, período e timezone. Mostrar dado estimado como estimativa. Resolver a divergência observada entre cartões e funil por definição consistente, sem reproduzir valores contraditórios hardcoded.

Checklist de seis etapas e passeios contextuais por área. Ajuda acessível sem perder a tarefa atual. Estado de conclusão por usuário/workspace, sem alterar dados operacionais durante um passeio.

## 5. Modelo lógico proposto

Agrupamentos, sem alegar que são as tabelas do original:

- Identidade: usuário, workspace, membro, sessão, convite, auditoria.
- Cobrança: plano/versionamento, assinatura, entitlement, uso, ledger de créditos e evento de cobrança.
- Contexto: perfil da empresa/produto, fontes, versão, aprovação e feedback.
- Dados: empresa, pessoa, ponto de contato, lista, associação, importação, fonte e supressão.
- Prospecção: definição de extração, execução, resultado, deduplicação, tarefa/veredito de qualificação e enriquecimento.
- Automação: definição, proposta IA, aprovação, agendamento, execução e checkpoint.
- Cadência: definição, versão, etapa, inscrição do lead, próxima ação, envio e evento.
- Canais: credencial, conexão, capacidade, webhook recebido, conversa, mensagem e anexo.
- Integrações: conexão externa, mapeamento, entrega, retry e dead letter.

Dados temporários, erros e resultados de cada etapa devem ser consultáveis sem expor segredos. A identidade do workspace não vem de um parâmetro de cliente sem validação da sessão.

## 6. Contratos e controle humano

Separar endpoints de sugestão, preview, criação de rascunho e ativação. Cada mutação valida autorização, schema, versão e idempotência. Propostas devem incluir o efeito exato: lista, automações, horário, destino, teto de uso e mensagens. Confirmar a criação não autoriza cobrança nem envio de mensagens por si só.

Erros estruturados precisam ser exibidos com ação recuperável. Cancelar, voltar e refazer uma proposta não podem criar registros órfãos. Logs registram evento e identidade técnica, sem corpos sensíveis por padrão.

## 7. Marcos e critérios de aceite

| Marco | Entrega | Evidência de aceite |
| --- | --- | --- |
| A | Shell e todos os fluxos centrais navegáveis com dados locais de demonstração identificados | Comparação visual de telas-chave, formulários, estados e responsividade |
| B | Contas, workspace, persistência, planos e cotas | Testes de isolamento entre dois clientes, papéis, sessão e ledger |
| C | Prospecção e qualificação reais com um provedor por fonte priorizada | Execução ponta a ponta, resultados, deduplicação, cancelamento e falhas |
| D | Automação por IA e cadência com aprovação | Sugestão não altera dados; criação atômica e idempotente; revisão antes da ativação |
| E | E-mail e WhatsApp, inbox e scheduler | Sandbox: enviar, receber resposta, parar próximos envios, reconectar e respeitar limite agregado |
| F | Cobrança, LinkedIn, SDR e integrações | Webhooks assinados, renovação/cancelamento, fluxos pagos/conectados e autorização por escopo |
| G | Paridade verificável e preparo de produção | Inventário sem lacunas escondidas, testes de segurança/recuperação e comparação de fluxos reais |

Ordem proposta: A → B → C → D → E → F → G. O plano detalhado de implementação será escrito após revisão desta especificação; esta seção não substitui esse plano.

Testes de comportamento essenciais: isolamento multi-tenant; retry sem envio duplicado; resposta/opt-out antes da etapa seguinte; concorrência pelo limite diário; mudança de fuso/dia útil; reinício do worker; crédito sem cobrança duplicada; webhook repetido/fora de ordem; perda de conexão; falha do modelo; cancelamento de execução; checkout cancelado; expiração do teste.

## 8. Pendências explícitas

Não há credenciais de provedores ou plano ativo inferidos deste levantamento. Integrações reais e preços próprios serão definidos e validados em seus marcos, sem impedir a construção da base. Nenhum marco será marcado concluído usando mock como prova de integração real.

A cobertura do original permanece parcial: execução de canais, SDR, LinkedIn conectado, detalhes de Saúde e ciclo financeiro não observados integralmente. Não prometer cópia exata do backend privado. A meta de paridade visual e funcional será verificada por superfície e caso de uso.
