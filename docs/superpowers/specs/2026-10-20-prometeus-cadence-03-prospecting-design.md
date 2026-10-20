# Marco 03 — prospecção e qualificação com IA híbrida

Estado: desenho proposto para revisão do usuário, ainda sem implementação. Complementa a [especificação geral aprovada](2026-10-20-prometeus-cadence-design.md) e o [roteiro](../plans/2026-10-20-prometeus-cadence-roadmap.md). Base: `178cbf9`, marcos 01–02 publicados na main. Execução nativa preservada como preferência do usuário; o plano executável será escrito após a revisão deste documento.

## 1. Resultado esperado e contexto

Transformar os fluxos simulados de geração/qualificação em operações reais, persistentes, acompanháveis e recuperáveis. Manter a UX observada no CadenceFlow: formulário → revisão de escopo/uso → botão explícito → execução → resultados. O fluxo principal não é chat.

O usuário escolheu Apify, possui conta Apollo e ainda não adicionou saldo aos dois. Para IA, suas escolhas principais são JEV pelo OpenRouter e Codex CLI autenticado via ChatGPT na fase de testes. O [estudo prévio](../../reverse-engineering/JEV-HYBRID-STUDY.md) fundamenta a composição: JEV decide, o modelo generativo escreve. Preservar `typesafe/jev-1.13`, sem trocar pelo modelo mais novo ou por um router.

O aceite local inclui conectores com contratos reais e testes de falha, sem exigir compra de créditos. A comprovação de ponta a ponta em cada serviço depende de credencial, elegibilidade/saldo e execução autorizada com limite definido; pendência externa será declarada e não substituída por resultado fictício.

## 2. Abordagem escolhida para proposta

**Adaptadores independentes, worker próprio e fila no PostgreSQL existente.** O processo web prepara/confirma e mostra o estado; o worker executa operações longas. Não adicionar Redis neste marco. Reaproveitar as transações, papéis, RLS e limites do marco 02.

As alternativas avaliadas foram executar toda a busca na requisição web (mais simples, mas perde controle com timeout/desconexão) e montar já a base nacional de CNPJ com coletores próprios (operação de dados maior que esta primeira integração). Ambas ficam fora da proposta.

Não foi possível refazer a inspeção da sessão autenticada neste turno: o REA não encontrou target do domínio no endpoint conectado e o acesso Chrome pelo app estava desativado. O levantamento anterior permanece a referência. A consulta de disponibilidade ao O Setup retornou 401; não foi instalado ou criado novo MCP/plugin/skill. Evidência em [descoberta do marco](../../reverse-engineering/MILESTONE-03-DISCOVERY.md).

## 3. Fontes e capacidades

| Fonte | Comportamento no marco |
| --- | --- |
| Maps / Apify | Nicho, localização, limite e lista de destino; adaptar resultados empresariais e guardar referência da origem |
| Web / Apify | Consulta e localização; transformar resultados em candidatos, mantendo URL e trecho; ler a página antes de afirmar fatos não presentes no resultado |
| CNPJ / Apify | Busca/consulta por contrato específico de Actor; aplicar somente filtros sustentados pelos campos retornados, indicando limitações e data da fonte |
| Apollo | Busca empresarial por endpoint oficial, com requisito de créditos/elegibilidade explícito; dados de pessoas não são representados como empresas |

Perfis de Actor são definidos no servidor com ID, build, versão do mapeamento, capabilities e limites. Candidatos documentados: `compass/crawler-google-places`, `apify/google-search-scraper` e `bigdavidson/brazil-cnpj-companies`. Os dois primeiros têm manutenção declarada pela Apify; o terceiro é comunitário. Antes da habilitação real, conferir metadados, input, output, build e preço do perfil configurado. Não executar um ID/build arbitrário enviado pelo navegador nem usar `latest` implicitamente.

O conector CNPJ não equivale a ter importado uma base nacional local. Não exibir “120M+” como capacidade própria. Filtro não suportado deve ficar indisponível, ou ser identificado como pós-filtro sobre a amostra obtida; não anunciar busca exaustiva no mercado. Se o Actor não devolver o campo necessário, não tentar aplicá-lo silenciosamente.

Apollo People Search sem créditos não retorna e-mail/telefone e não é equivalente à busca de empresas ou ao enriquecimento. Enriquecimento cobrável de decisores e sincronização CRM completos ficam para entrega própria posterior. A UI deve deixar essa distinção clara.

## 4. Fluxos e confirmação

### Geração

Selecionar fonte, filtros, destino e quantidade. Revisão mostra limites, capacidades disponíveis, operações externas e uso previsto/desconhecido. Somente **Executar busca** cria job e, quando solicitado, lista vazia na mesma transação. Preparar/revisar não inicia run no provedor.

O worker normaliza e publica resultados progressivamente em lotes transacionais. A tela mostra encontrados, inseridos, duplicados, rejeitados, pendentes e fonte do dado. Quantidade desconhecida permanece desconhecida; não inventar percentual de progresso a partir de temporizador.

### Qualificação

Selecionar lista/leads, módulos e contexto aprovado. O job captura uma versão dos critérios e prepara resultados por módulo. Extração/decisões são apresentadas em revisão antes de **Aplicar resultados**, que confirma as alterações selecionadas. Uma resposta do modelo não ativa cadência nem inicia mensagem.

O resultado mostra dado anterior, sugestão, motivo estruturado, fonte e status de cada módulo. Aplicar não sobrescreve correção humana ocorrida durante o job: compara a base dos campos e apresenta conflito para revisão. A aplicação de cada seleção é atômica e idempotente.

### Histórico e recuperação

Histórico de jobs tem filtros, contagens, erros acionáveis, detalhes de uso e cancelamento. Fechar o navegador não cancela o job. Acesso perdido ou workspace trocado segue as proteções do marco 02; nenhum cache anterior reaparece. Atualizações de job não concedem a formulários antigos permissão para sobrescrever dados novos.

## 5. Coleta e módulos

- Extrair e-mails/telefones e texto a partir de fontes obtidas, com URL e instante. HTML/scripts de sites são dados não confiáveis; não executar comandos ou instruções encontrados neles.
- Leitura limitada a até três páginas por domínio no modo profundo, corpo de até 1 MB por página e timeout por requisição. Tratar redirects, tipo de conteúdo, erros e bloqueios explicitamente. Restringir a destinos públicos HTTP(S), impedindo acesso a loopback, redes privadas, metadata de nuvem e DNS rebinding.
- Verificação de e-mail deste marco cobre formato e domínio/DNS. Não afirmar existência de caixa postal sem integração própria para essa verificação. Validação de número WhatsApp depende do marco de canais e permanece indisponível.
- Descoberta de site usa a fonte de busca e registra evidência; não inventa domínio pela razão social.
- Consulta cadastral e filtros CNPJ guardam dados efetivamente retornados; ausência de campo não vira zero ou falso. Normalização preserva identificadores alfanuméricos e zeros iniciais.
- Falha de módulo, evidência ausente e decisão negativa são estados distintos. Dados já conhecidos permanecem preservados.

## 6. JEV e geração: contratos diferentes

O decisor recebe estado estruturado: dados empresariais, trechos identificados, critérios aprovados e versão. O JEV usa a Decisions API do OpenRouter; não o endpoint de chat. A saída validada contém categoria, critérios julgados, probabilidades/confiança quando disponíveis e identificação do modelo/contrato.

Categorias iniciais: `fits`, `does_not_fit`, `insufficient_evidence`. Dados insuficientes ou confiança não aceita resultam em pendência/revisão. Não interpretar `confidence` como acurácia calibrada nem copiar um limiar universal de um tutorial. Motivos legíveis vêm de códigos de critérios e fontes, sem atribuir ao JEV uma justificativa livre que ele não produziu.

O gerador recebe os mesmos trechos e uma tarefa de prosa/extração estruturada. Sua saída contém resumo e referências de evidência; não pode inventar fatos comerciais. Resumos só são gerados quando o usuário seleciona o módulo ou solicita a tarefa. O caminho em volume não chama o gerador para cada item por padrão.

Caso ambíguo com evidência pode receber uma segunda análise generativa somente quando essa política tiver sido explicitamente selecionada na revisão do job, dentro do orçamento. Sem evidência, a saída continua pendente em vez de escalar para um palpite. A falta de credencial/quota não ativa outro provedor silenciosamente.

O padrão “gerar texto → verificar com JEV” fica disponível ao desenho de evolução, mas não entra como obrigação de toda geração deste marco. Sua utilidade e custo precisam ser medidos.

## 7. Codex CLI local

Implementar adaptador opt-in para o CLI já instalado e autenticado, usando o mecanismo de login do próprio CLI. Não copiar tokens OAuth para uma tabela, `.env`, frontend ou transporte HTTP próprio. Receber conteúdo por stdin, resultado por JSON Schema, sessão efêmera e cancelamento/timeout do processo completo.

Execução em diretório de trabalho temporário sem código/segredos, sandbox read-only, configuração pessoal de MCPs/hooks não herdada e sem ferramentas do produto. A validação deve comprovar os argumentos e as restrições da versão instalada. Se a configuração efetiva não puder atender essas restrições, mostrar indisponibilidade em vez de executar com acesso amplo.

Disponível somente no modo de implantação local explícito, com binding loopback e workspace de testes autorizado no servidor; não depende somente de `NODE_ENV` ou de header Host enviado pelo cliente. Concorrência 1. Não expor a execução do CLI para clientes de uma implantação pública. O modelo é configurável conforme o acesso real da conta e o consumo pertence ao limite da assinatura autenticada.

OpenAI API/Gemini podem ser adaptadores futuros; não serão conectados nem usados como fallback sem configuração explícita. A preferência deste marco continua JEV + Codex CLI local.

## 8. Jobs, transações e uso

Estados persistidos distinguem fila, execução, espera pelo provedor, reconciliação necessária, cancelamento solicitado, cancelado, concluído, parcial e falha. Checkpoint inclui run/dataset/cursor externos quando existirem. Lease/heartbeat permitem retomada; uma lease vencida não autoriza duplicar o start externo.

**Resposta perdida em start cobrável:** preservar intenção e entrar em reconciliação quando não houver run ID confirmado. Não assumir exactly-once remoto nem fazer retry cego. Polling/leituras recuperáveis podem ter retry limitado com backoff. DTO e logs não incluem tokens ou corpos externos não sanitizados.

**Cancelamento:** parar de agendar trabalho, solicitar aborto quando suportado e acompanhar confirmação. Preservar resultados/consumo já confirmados; cancelamento não promete estorno do provedor. Worker parado no meio pode retomar ou reconciliar sem duplicar inserção/uso.

**Uso:** ledger de reserva, consumo e liberação por operação e workspace, idempotente. Registrar unidades reais, tokens, fonte de preço e custo informado/estimado/desconhecido separadamente. Respeitar limite global da credencial compartilhada e limite por workspace. Limites Apify são aplicados conforme o modelo de cobrança do Actor; não há promessa de um teto universal de todos os custos externos.

Limites iniciais: até 500 candidatos/registros por job, páginas processadas em lotes de até 100, uma operação externa ativa por workspace e uma chamada Codex ativa na máquina. Paginação de histórico e resultados no servidor; não carregar respostas brutas inteiras no snapshot da aplicação. Concorrência global dos demais provedores é configuração de operação no servidor.

Um lote e seu checkpoint são gravados juntos. Job com lotes anteriores confirmados e falha posterior apresenta estado parcial e contagens exatas, sem alegar rollback do que já foi publicado. O consumo externo pode existir mesmo sem inserção de um lead, e não é confundido com créditos comerciais vendidos no futuro.

## 9. Identidade, deduplicação e isolamento

Todas as entidades de job, item, evidência, resultado e uso pertencem ao workspace e recebem RLS/FKs compostas. O worker usa acesso mínimo e funções de claim com escopo limitado, sem expor um usuário runtime superuser/BYPASSRLS. Revalidar associação/permissão do emissor e autorização do workspace na execução/aplicação; remoção impede novas alterações por esse job.

Identidade externa e normalização precedem inserção. Deduplicação concorrente é transacional e respeita o escopo escolhido, lista ou workspace. Cadastro existente em outra lista não é movido silenciosamente. Telefones centrais, e-mails contábeis e domínios compartilhados são sinais ambíguos, não autorização para fundir empresas diferentes. Conflitos ficam visíveis.

Manter IDs e registros do marco 02. Migrações são aditivas e checksums aplicados não mudam. Evidências e metadados de provedor não podem ser forjados pelas mutações públicas de contatos.

## 10. Avaliação e aceite

1. Testes RED→GREEN dos adaptadores com respostas oficiais representativas, formato inválido, credencial ausente, 402/403/429, timeout, cancelamento e resposta perdida; sem chamadas pagas na suíte padrão.
2. PostgreSQL real: dois workspaces, claims concorrentes, revogação, RLS, lease vencida, rollback do lote/checkpoint, deduplicação simultânea e ledger idempotente.
3. JEV: contrato Choice/Noul/Score, categoria desconhecida, confiança ausente, evidência insuficiente, conteúdo malicioso e erro de provedor. Nenhum desses vira aprovação ou desqualificação fictícia.
4. Codex: processo falso para timeout/quota/JSON inválido e verificação dos argumentos; smoke local real separado, com dados sintéticos e consumo explicitamente limitado. Teste local não mede capacidade comercial.
5. UI: revisão sem efeito externo, clique repetido cria um job, progresso real, cancelamento, retorno ao histórico após recarga, resultado parcial, edição humana concorrente e troca de workspace.
6. Piloto rotulado proposto no estudo: 100 casos PT-BR, parte de ajuste separada do teste por empresa/domínio. Sem credenciais/dados rotulados, entregar o harness e marcar a avaliação empírica como pendente. Nenhum limiar será vendido como qualidade comprovada antes dessa etapa.
7. Rodar regressões dos marcos 01–02, TypeScript, build e smoke. Registrar por fonte se o aceite foi de contrato, integração local ou chamada real. Não afirmar paridade operacional integral com o CadenceFlow com base em fixtures.

## 11. Fora deste marco

Scheduler recorrente e automações ativas; criação de planos/cadências por IA real em outros fluxos; envios, inbox real e validação WhatsApp; cobrança comercial/assinatura; LinkedIn, SDR e CRM completos; importação integral da Receita; escala comprovada de milhões de leads; deploy público do adaptador Codex.

Automações existentes continuam pausadas e cadências rascunhos. Este marco cria a base de execução e qualificação que os próximos reutilizam.

## 12. Auto-revisão do desenho

Os limites de conta gratuita não foram confundidos com saldo disponível; JEV decisão foi separado de geração; o modo Codex local foi separado de implantação compartilhada; uso técnico foi separado de billing comercial; resposta perdida não tem retry cobrável cego; cancelamento não promete reembolso; aplicação de sugestões não sobrescreve correção humana. O aceite distingue simulação de contrato e serviço realmente exercitado. Não há alteração de código de produto antes da revisão desta especificação e do plano de implementação.
