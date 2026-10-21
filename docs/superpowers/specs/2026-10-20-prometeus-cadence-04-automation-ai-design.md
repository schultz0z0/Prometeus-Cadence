# Marco 04 — contexto, propostas de IA e automações recorrentes

Data: 20/10/2026. Base funcional: `main`, commit `191330c`. Execução nativa nesta conversa, conforme preferência já escolhida pelo usuário.

## 1. Objetivo e entendimento

O usuário quer continuar a reconstrução do CadenceFlow usando a engenharia reversa existente, mantendo a experiência por formulários, propostas editáveis e botões de confirmação. O marco04 transforma os fluxos demonstrativos de contexto, público e cadência em IA real e conecta as automações salvas ao processamento recorrente no servidor.

Aceite principal: ler um site público e revisar o perfil; solicitar três planos de público; editar e confirmar um plano para criar uma lista e duas automações pausadas; solicitar três sequências de cadência e salvar uma como rascunho; ativar explicitamente uma automação elegível para gerar jobs persistentes nos horários aprovados, independentemente do navegador.

Gerar conteúdo autoriza somente a análise apresentada, com seu orçamento. Criar objetos e ativar recorrência são ações posteriores e distintas. Resultados de qualificação continuam propostas para aplicação humana, como nos marcos03/03B. Nenhum passo deste marco envia mensagens.

## 2. Evidência e limites da referência

Reaproveitar `docs/reverse-engineering/FINDINGS.md`, `SURFACE-MAP.md`, prints U14–U18, as observações autenticadas anteriores e o resumo REA do cliente. Foram observados: contexto lido de um domínio e revisado; três planos de público; lista e duas automações criadas após confirmação; busca às7h e qualificação às8h; cadência com três etapas de criação e três opções editáveis; frequências única/diária/semanal/quinzenal/mensal/personalizada.

As rotas de cliente `/api/automations/ai-plano`, `/api/cadences/ai-options`, `/api/cadences/preview-ai` e `/api/contexto/gerar` são evidência estática, não contratos validados do backend. As escolhas técnicas abaixo pertencem ao Prometeus Cadence.

Nesta continuidade, o MCP REA respondeu à consulta de alvos, mas não alcançou `http://127.0.0.1:9222` (`provider_unavailable`, `endpoint_unreachable`). Não houve nova observação autenticada nem alteração do Chrome. Esse limite não impede usar o levantamento já preservado.

## 3. Abordagens e decisão proposta

1. **Reutilizar a base03B e entregar o ciclo completo deste marco, em blocos dependentes**: tarefas de planejamento → confirmação de objetos → recorrência. Recomendado: mantém uma fila, um ledger de uso, o mesmo roteamento e os limites já validados.
2. Entregar somente os geradores de contexto/público/mensagens agora: menor mudança, mas deixa os horários das automações sem efeito real.
3. Priorizar somente a recorrência: aproveita as automações manuais, mas preserva propostas demonstrativas no fluxo principal observado.

A proposta é a primeira. Reutilizar PostgreSQL local/Docker, worker, transportes e skills já existentes; nenhum novo serviço, plugin ou dependência é necessário para o desenho. O acervo O Setup não expõe ferramentas nesta sessão; a tentativa anterior registrada retornou401. Não se afirma ausência de recursos nem se recomenda instalar substitutos.

## 4. Fronteiras do marco

Inclui contexto da empresa e perfis de produtos, propostas reais de público, opções reais de cadência, prévia textual solicitada explicitamente para um lead, criação transacional, ativação/pausa e agendador de prospecção/qualificação. Preservar caminhos manuais, clonagem/modelos e modo demonstrativo identificado.

Envio, inbox real, stop-on-reply operacional, WhatsApp/e-mail/LinkedIn conectados, SDR e billing permanecem nos marcos seguintes. As cadências deste marco nascem em rascunho e não podem ser ativadas para envio. Fontes não suportadas pelos adaptadores atuais, como reengajamento operacional, continuam bloqueadas com motivo.

## 5. Contrato comum de tarefas de planejamento

Estender a infraestrutura atual de jobs com um tipo discriminado de planejamento e tarefas fechadas: `context_read`, `audience_plan`, `cadence_options`, `message_preview`. A migração torna `list_id` opcional somente para planejamento; geração e qualificação preservam a exigência de lista. Nunca criar lista ou lead fictício para acomodar a FK antes da confirmação.

Reutilizar lease/fence, journal, reserva/consumo/liberação, cancelamento e reconciliação por operação. Worker despacha por tipo explicitamente; planejamento nunca cai no handler de qualificação por um `else` genérico. Payloads/resultados possuem schemas próprios e versão de contrato; os jobs antigos mantêm os seus contratos.

Preparar a revisão de uma tarefa não faz rede nem grava objetos de domínio. A revisão apresenta tarefa, provedor/modelo, quantidade máxima de chamadas, fontes e bloqueios. Confirmar o botão de análise cria somente job/reserva e registros técnicos de análise; contexto aprovado, produtos, listas, automações, cadências e leads não são alterados. As propostas persistidas são distinguíveis dos objetos confirmados.

RequestId estável e hash do corpo protegem clique duplo, timeout e retry. HMAC vincula usuário, workspace, tarefa, entrada, revisões de contexto/base, política de IA, limites efetivos e contrato. Repetição de uma confirmação já comprometida retorna o mesmo job antes de rejeitar a prova por expiração; corpo diferente com a mesma identidade gera409.

As propostas guardam job de origem, entradas congeladas, evidências, rota e revisão. A confirmação do objeto escolhido é outra operação idempotente: aceita somente um resultado válido do workspace e suas edições permitidas; não confia em um objeto arbitrário do navegador como se fosse resultado da IA. Correções humanas são persistidas com origem manual e não precisam fingir evidência externa.

## 6. Roteamento e consumo de IA

Preservar os três modos do03B. Sem JEV, Codex/OpenAI/Gemini selecionado gera as propostas e realiza todas as decisões necessárias. Com JEV elegível, a convencional gera o conteúdo e o JEV avalia/recomenda entre opções estruturadas de público/cadência; o JEV não produz mensagens nem funciona sozinho. A recomendação não escolhe ou confirma pelo usuário.

Contexto e prévia textual são tarefas de geração convencional, sem chamada JEV desnecessária. Revisão deve mostrar as etapas realmente previstas. Tarefas com avaliação JEV exigem o mesmo teste convencional válido, configuração e revalidação imediatamente antes do despacho, incluindo após diagnóstico assíncrono do Codex. Em modo híbrido obrigatório, ausência de qualquer componente bloqueia a tarefa; não há troca silenciosa de rota.

Uma chamada convencional retorna o conjunto de três opções. Em híbrido, uma chamada JEV avalia esse conjunto sem encadear chamadas por opção. Contexto e prévia: até1 convencional; público/cadência: até1 convencional mais1 JEV quando previsto. Nenhum retry de conteúdo inválido, recusa ou resposta perdida é automático ou gratuito. Novo pedido de sugestões custa uma nova análise confirmada.

Limites ambientais, política persistida do workspace e consumo/reservas existentes são sempre respeitados. Fingerprints não saem no DTO. Modelos/chaves permanecem no servidor e Codex continua local/loopback/allowlist. Prompts de sites/leads são dados não confiáveis, sem ferramentas ou execução. O tamanho do mercado fica desconhecido salvo consulta específica comprovada; a IA não o estima como fato.

## 7. Contexto da empresa e dos produtos

Em Contexto de IA, informar domínio e solicitar leitura com revisão de custo. Coletar páginas públicas usando o transporte já protegido contra SSRF, redirecionamento privado, excesso de páginas/bytes e conteúdo executável. Guardar URL, hash, data e trechos limitados; a LLM não recebe credenciais, cookies ou conteúdo de sessões autenticadas.

A proposta contém os campos atuais — nome, oferta, cliente ideal, dores, diferenciais, concorrentes, prova social, produtos e fontes — com referências de evidência por campo e indicação de informação ausente. Não inventar preços, clientes, números, concorrentes ou benefícios. Campos sem suporte ficam vazios ou explicitamente desconhecidos.

A releitura abre comparação entre base, sugestão e edição atual. Não sobrescrever correções humanas nem texto digitado enquanto o job executava. Aplicar campos selecionados apenas ao formulário/rascunho; aprovar e salvar é ação separada, com papel e revisão revalidados. Alteração concorrente exige revisão, sem rebase silencioso.

Adicionar perfis de produtos versionados e vinculados ao workspace, com nome, oferta, público, diferenciais, provas/fontes e aprovação próprios. Eles podem ser criados manualmente ou propostos pela leitura; nenhum nasce aprovado. Preservar o campo textual de produtos do perfil atual como conteúdo legado compatível, sem apagá-lo nem sincronizá-lo silenciosamente com as novas entidades. Seleção explícita de produto nas gerações congela o perfil aprovado desse produto mais o contexto da empresa.

Rascunho e último contexto aprovado permanecem distintos. Jobs usam somente a versão aprovada congelada; a aprovação de nova versão não reinterpreta resultados anteriores. Se faltar contexto suficiente, indicar os campos faltantes e oferecer continuação manual identificada, sem fallback demonstrativo em uma conta real.

## 8. Automação com IA

Manter público + canal → Montar plano → três cards → editar/revisar → Criar assim. As propostas incluem título, lista, fonte suportada, filtros válidos, canal, limite diário, critérios de qualificação, módulos e horários/fuso. Os limites são configuráveis e delimitados pelo servidor;150/dia é uma referência visual, não orçamento autorizado nem valor obrigatório.

Validar a saída contra os perfis reais dos adaptadores. Fonte sem configuração pode aparecer como proposta, mas exibe o requisito e não pode ser ativada. Filtros sem contrato não são anunciados como executáveis; o usuário pode ajustar a proposta antes de criar. Exibir separadamente limite diário e tamanho de mercado desconhecido.

Confirmar uma opção cria, em uma única transação, uma lista e duas definições de automação pausadas, suas revisões e vínculos. Não cria job de busca/qualificação nesse momento. Repetição após resposta perdida devolve os mesmos IDs. A edição humana integra o hash e a prova da confirmação; não é descartada em favor do texto original do modelo.

O resultado oferece Criar a cadência dessa lista. O fluxo leva lista/canal/produto aprovados à cadência sem iniciar outra análise por navegação. Os horários sugeridos de7h/8h são editáveis. A qualificação dependente aguarda a conclusão da busca da ocorrência correspondente se ela passar do horário previsto, sem afirmar que houve processamento às8h quando a busca ainda estava ativa.

## 9. Cadências e prévia

Preservar Sobre a cadência → Opções da IA → Revisar e criar. Entrada: lista, contexto/produto aprovados, objetivo, canais, tom, ritmo, destacar/evitar e decisor opcional. Retornar exatamente três sequências diferentes, com passos, esperas, assuntos quando exigidos e mensagens editáveis.

Aceitar somente canais/variáveis suportados. A IA não inventa contato, nome de decisor ou prova social. Variáveis ausentes são destacadas na prévia; não são preenchidas com dados fictícios. Informações do lead são dados, não instruções. Conferir ritmo, limites de etapas, espera não negativa e tamanho de texto no servidor.

Salvar a opção editada cria um rascunho idempotente, preservando a revisão-base e o contexto de origem. Mantém o editor/canvas existente. Mudança de lista/canal/contexto durante uma análise exige nova revisão, sem sobrescrever edição aberta em outra aba.

Uma prévia personalizada para um lead é outra tarefa explicitamente solicitada, com custo e evidências daquele lead; não gera automaticamente para a lista inteira e não salva a mensagem como enviada. A tarefa devolve proposta para comparar/aceitar no editor. Criar um rascunho não depende de canal conectado; ativação de envio permanece bloqueada neste marco.

## 10. Agendamento e autorização recorrente

Ativação exige owner/admin e revisão dos efeitos: fonte/lista, filtros, volume por ocorrência, módulos, horários/fuso, contexto/rota, limites e dependências. Confirmar ativa aquela revisão e autoriza somente execuções futuras dentro desse escopo. Editar uma automação ativa pausa a recorrência e exige nova ativação; não herda uma autorização anterior para fonte, custo ou configuração diferentes.

Guardar definição versionada, autorização de ativação, próximo horário UTC, fuso IANA, estado e ocorrências. Frequências: única com data/hora; diária; semanal com dias; quinzenal ancorada em uma data local; mensal com dia configurado, limitado ao último dia quando ausente; personalizada com intervalo inteiro de dias e data de ancoragem. Não executar expressão cron arbitrária recebida do cliente.

Definir horários inexistentes em mudança de fuso para o primeiro instante válido seguinte; em horário repetido executar uma única vez no primeiro instante. Testar esses casos, virada de mês/ano e fronteiras de data local/UTC. Calendário é cálculo de servidor; não depende do relógio do navegador.

O scheduler é um processo separado e controlável, usando o PostgreSQL já existente. Sua claim entre workspaces ocorre somente por função estreita com grants próprios; não dar BYPASSRLS nem acesso geral ao auth para o worker. Depois da claim, revalidar membership/papel do autorizador, status/revisão da automação, configuração/rota e limites no workspace correto.

Cada ocorrência possui identidade única por workspace/automação/revisão/horário programado. Registrar ocorrência, job/reserva e próximo horário em transação; crash ou duas instâncias não criam duplicatas. Uma automação não sobrepõe ocorrências enquanto um job anterior permanece ativo/incerto. Seguir a ordem de locks existente e o fencing; nenhum processo com lease antiga publica novos jobs/resultados.

Após indisponibilidade prolongada, executar no máximo a ocorrência vencida mais recente, registrar as janelas omitidas e seguir para o próximo horário futuro. Não executar uma rajada de todos os dias perdidos. Pausa/reativação não repete uma ocorrência já criada. Mudança de programação cria nova revisão e mantém histórico das anteriores.

Pausar impede novas ocorrências e novos despachos de jobs recorrentes ainda na fila; exibir os jobs ligados à pausa. Uma operação já enviada ao provedor mantém seu resultado/consumo e segue cancelamento/reconciliação explícitos; não liberar reserva desconhecida. A ação separada Cancelar execução atua no job selecionado.

Falta de credencial, mudança de rota/contexto aprovado, teste híbrido expirado ou papel removido bloqueiam a automação com motivo e ação de revisão. Não trocar para outro provedor. Limite diário insuficiente registra a ocorrência bloqueada sem órfãos nem chamada; a próxima janela pode usar a autorização original se configuração/revisão não mudaram. Teste híbrido continua expirando após24h; não há teste de conexão pago automático para renovar essa validade.

## 11. Seleção de leads e dependências

Busca recorrente reutiliza ingestão/deduplicação real do03. Para automações vinculadas, qualificação seleciona IDs efetivamente inseridos na busca correspondente; resultados parciais válidos podem ser processados e são identificados como parciais. Qualificação independente de lista seleciona um lote delimitado de leads elegíveis.

Guardar a atribuição dos leads por automação/revisão/contrato de qualificação. Lead com resultado pendente de revisão, processamento ativo ou tentativa incerta não recebe outra chamada recorrente equivalente. A qualificação continua pendente de aplicação humana; isso não pode causar requalificação paga diária do mesmo lead.

Falhas, ausência de evidência e parcelas não processadas aparecem por lead. Reprocessar itens já tentados exige nova ação/revisão explícita; não há repetição paga automática para obter um resultado diferente. Limitar tamanho do lote e custo por ocorrência; se a lista tiver mais leads, manter backlog visível e cursor durável, sem perder ou duplicar atribuições.

## 12. Interface, histórico e permissões

Remover mensagens de demonstração somente nos caminhos autenticados realmente conectados. Exibir estados reais de análise, fonte/rota/modelo, custo desconhecido, propostas, origem e horários. Erros não viram sucesso visual; resposta tardia de outro workspace é descartada. Preservar IDs de confirmação e texto humano após timeout/conflito.

Na lista de automações: próxima ocorrência, última execução real, estado/bloqueio, ativar/pausar/executar uma vez e link para o histórico de jobs. Executar uma vez exige revisão própria e não muda o estado da recorrência. Histórico permite filtrar tipo/estado/fonte/automação e diferencia geração pontual, análise de planejamento e ocorrência agendada.

Owner/admin gerenciam política, contexto aprovado, perfis de produtos e autorização recorrente. Operator pode ler configurações e criar/revisar tarefas operacionais permitidas por data.write; não aprova contexto, ativa recorrência ou altera seus limites. Remoção de acesso bloqueia novas ações e publicação tardia, sem mostrar dados de outro workspace.

## 13. Migração e compatibilidade

Migrações aditivas após013, preservando checksums/LF e sem recriar volumes. Novas tabelas de proposta, produto, programação/ocorrência/atribuição têm workspace e FKs compostas, RLS, grants explícitos e auditoria. Revogar privilégios herdados que permitam cliente comum fabricar atestado, ocorrência, reserva ou ativação. Não confiar em status active vindo do schema genérico automation.save.

Automações existentes permanecem pausadas e sem autorização recorrente. Seus horários são preservados; configurações legadas incompletas exigem revisão antes de ativar. Atualizações do snapshot mantêm os fluxos existentes e distinguem definição, estado operacional e proposta. Demos continuam locais e identificadas; indisponibilidade de IA/banco não muda uma conta real para demo.

## 14. Verificação e limites do aceite

Testes de domínio/cliente para schemas, três opções, ausência de contagens inventadas, edição preservada, variáveis, confirmação idempotente e troca de workspace. Integração PostgreSQL para rollback, RLS/papéis, prova obsoleta, limites efetivos, jobs sem lista, lease/fence, interrupção antes/depois do resultado, reconciliação e aplicação do objeto uma única vez.

Scheduler deve provar duas instâncias concorrentes, crash após commit, pausa/revisão/revogação antes do despacho, não sobreposição, backlog, dependência lenta, consumo retido, fuso/DST e recuperação sem rajada. Harness privado usa provedores/relógio controlados; fixtures nunca são fallback do produto nem recebem rótulo de execução externa real.

Aceite visual desktop/mobile dos fluxos e estados, quando a automação do navegador estiver acessível. Build, typecheck, testes unitários/integração e smoke anônimo. Registrar separadamente aquilo que foi exercitado com fixtures, aquilo que foi observado no browser e chamadas externas reais.

As três inferências autorizadas para03B já foram consumidas. Planejar04 sem aumentar orçamento ou consumir novas inferências/Apify/Apollo/JEV. Um eventual piloto real terá teto e workspace próprios apresentados para autorização explícita; falta de saldo não impede validar implementação com contratos e banco local, mas impede afirmar integração real de fontes não exercitadas. Nenhuma nova instalação de serviço ou compra é pressuposta.

## 15. Critérios de conclusão

1. Contexto e produtos podem ser propostos com fontes, comparados e aprovados sem apagar correções humanas.
2. Público e cadência usam a LLM escolhida e retornam três opções reais estruturadas, respeitando o roteamento03B; conta real não usa gerador demonstrativo.
3. Confirmar público cria exatamente uma lista e duas automações pausadas; confirmar cadência cria um rascunho; análise e navegação não fazem essas criações.
4. Ativação explícita e revisada produz jobs reais por horário, com isolamento, orçamento, histórico e recuperação; qualificação não é repetida só porque a proposta ainda não foi aplicada.
5. Nenhuma mensagem é enviada, nenhuma decisão de IA é aplicada ao lead sem aprovação e nenhuma automação antiga passa a rodar por efeito da migração.

## Estado e próxima etapa

Desenho escrito para revisão do usuário. Auto-revisão: contratos de proposta/confirmar/ativar separados; orçamento e validade03B preservados; recorrência não se confunde com envio; jobs de planejamento não exigem objetos fictícios; dados observados e escolhas próprias identificados. Após aprovação deste documento, escrever plano executável por blocos, com testes RED→GREEN e execução nativa. Ainda não há código do marco04 implementado.
