# Validação do marco 01 — 20/10/2026

Escopo: primeira aplicação local navegável, conforme o plano aprovado. A equivalência integral do SaaS e dos seus serviços não foi demonstrada. Este relatório separa regras verificadas, observação manual e limitações.

## Verificação automatizada

- `rtk npm test`: 31/31 testes passam após a revisão, exit 0. Cobrem repositório imutável, roundtrip, falha de persistência, transações, clique repetido, importação, filtros, métricas, contexto, cadências e simuladores.
- `rtk npm run typecheck`: exit 0.
- `rtk npm run build`: exit 0, produção Next.js compilada, 26 rotas estáticas/dinâmicas e 22 páginas geradas.
- `rtk proxy node scripts/smoke-routes.mjs`: 42/42 rotas retornaram sucesso, exit 0; detalhes em [routes.json](routes.json). Esse teste não executa ações nem integrações reais.

As regressões foram reproduzidas antes da correção: preferências aninhadas inválidas, status desconhecido de lead, ritmos fora da duração escolhida e criação manual que não persistia a lista junto com a automação. Os testes passaram após as correções.

## Roteiros no navegador

Chrome isolado do MCP chrome-devtools, somente `127.0.0.1:3210`. A sessão autenticada do concorrente não foi modificada durante a validação do novo app.

1. Dashboard → automação com IA → descrição de público → três propostas → revisar → confirmar com clique duplo. Antes da confirmação não havia nova entidade. Depois: duas listas, quatro automações no total (duas iniciais + duas novas), todas pausadas e um registro de confirmação. IDs vinculados corretamente. Recarga preservou o resultado.
2. Resultado → criar cadência da lista → três sugestões → revisar → editar a primeira mensagem → salvar. Antes da revisão final havia uma cadência; depois havia duas, ambas rascunhos, com a nova vinculada à lista recém-criada. Recarga preservou mensagem e vínculo.
3. Contato fictício com nome longo e sem site/telefone: criar em 390px → pesquisar → abrir ficha → editar cidade/UF → recarregar. A ficha e o armazenamento mantiveram a edição. A tabela quebrou o nome em linhas, sem inventar contato.
4. Canvas: adicionar etapa de e-mail, preencher e aplicar, salvar e recarregar manteve quatro etapas. Prévia de variável ausente manteve o token e exibiu aviso. Inserção cancelada permaneceu com três etapas na cadência usada nesse teste; a lista vazia não apresentou leads de outra lista.
5. Filtro de módulo de automação apresentou somente as duas automações de qualificação. Todos os envios e respostas permaneceram em zero.
6. Preferências armazenadas como `{}`: barra de erro recuperável; conteúdo inválido preservado sem sobrescrita. Corrigido também o salvamento em modo de recuperação para não comunicar sucesso sem persistência. Dados de QA restaurados em seguida.
7. Coleções vazias: dashboard com zeros e sem crash. Dados restaurados após o teste.
8. Responsividade em 390×844: largura do documento igual a 390px, tabela com scroll interno e menu móvel. Menu fechado ficou fora da navegação de teclado após uso de `inert`. Em 1280×800: documento igual a 1280px e controles do canvas com limite inferior em 758px, dentro do viewport.
9. Importação: CSV colado com nome entre aspas contendo vírgula e sem telefone → preview de um contato válido → fechar sem confirmar. O total permaneceu em 21 contatos durante o preview e após cancelar.

As validações interativas são manuais e não substituem uma futura suíte E2E dos serviços reais. O rascunho da conversa de exemplo usa sessionStorage e é recuperado na mesma sessão.

## Conferência visual

Referências: prints U03–U18 do [manifesto](../reverse-engineering/screenshots/manifest.json), observação autenticada previamente registrada e CSS público inspecionado com REA. Prints com overlay de tutorial não são baselines de telas sem overlay. Não foi medida igualdade pixel a pixel.

| Ponto | Conferência | Resultado / diferença explícita |
|---|---|---|
| Tipografia e tokens | Sora/Manrope locais; primária #FF6B00; superfícies e bordas claras | Estrutura e hierarquia preservadas. Marca própria Prometeus Cadence. |
| Shell e densidade | Sidebar 250px, banner e topbar, grupos/submenus, seis métricas | Mesma organização. Dados fictícios coerentes (11 qualificados), diferentes dos 10 do print. |
| Automação | Lista agrupada com filtros; formulário de público e canais; três propostas; revisão explícita | Fluxo sem chatbot preservado. Propostas locais e mercado desconhecido indicados. |
| Canvas | Fundo pontilhado, nós, conectores, esperas roxas, mensagens verdes, minimapa e zoom | Controles ajustados para caber em 1280px. Estimativas reais não inventadas. |
| Canais e responsividade | Cards Meta/número próprio e menu de configurações; menu em drawer no celular | Cards lado a lado em telas maiores, empilhados no viewport de 1440px e no celular. Sem conexão real. |

Capturas próprias, inspecionadas visualmente:

- [Dashboard desktop](screenshots/dashboard-desktop.png) e [390px](screenshots/dashboard-mobile.png).
- [Contatos desktop](screenshots/contacts-desktop.png) e [menu em 390px](screenshots/contacts-mobile.png).
- [Automações](screenshots/automations-desktop.png), [wizard](screenshots/audience-wizard-desktop.png), [canvas](screenshots/canvas-desktop.png), [canais 1440px](screenshots/channels-desktop.png) e [1920px](screenshots/channels-wide.png).

O MCP de teste recusou escrita direta na pasta por sua configuração de roots; as mesmas imagens retornadas inline foram salvas como PNG, sem edição. Não foi alterada a configuração do navegador do usuário.

## Decisões de execução

- Repositório novo, pasta antes vazia: branch de feature no diretório indicado, sem segunda worktree. Se a premissa de isolamento mudar, será necessária uma worktree.
- Helpers POSIX da skill substituídos por ledger equivalente no Windows. Custo: registro manual do progresso.
- Porta 3210 porque 3000 já estava ocupada. Custo: URL local diferente.
- Regras puras compartilhadas implementadas em lote depois de observar RED, evitando contratos incompatíveis entre tarefas. Custo: testes por contrato, em vez de duplicados por tela.
- Captura de imagens via conteúdo inline do MCP porque sua configuração recusou o caminho direto. Bytes PNG preservados; custo: serialização local adicional.
- REA e skill existentes reaproveitados. Consulta O Setup pendente por HTTP 401; nenhum novo MCP/skill foi criado ou instalado.

## Limitações conhecidas

- Não há backend, usuários reais, isolamento de organizações, cobrança, jobs, IA externa ou conectores. Preços, estimativas e entregas reais permanecem ausentes.
- Algumas superfícies dependentes de serviços (segurança, membros, MCP, CRM, LinkedIn e SDR) exibem requisitos e prévias locais.
- Campos e filtros podem demonstrar configurações sem produzir execução real. O seletor de período ainda é visual na base demonstrativa.
- Não há guarda de navegação interna para formulários não confirmados; recarregar/abandonar descarta propostas temporárias. O editor de cadência avisa no refresh se houve mudança não salva.
- O tema escuro e acessibilidade ampla ainda precisam de auditoria específica; esta entrega verificou foco de modais/menu, nomes de controles e navegação básica.

Revisão independente concluída; cinco importantes corrigidos, e a divergência de contagem do pipeline reclassificada e corrigida. Evidência, decisões e verificações posteriores no [registro da revisão](review-01.md). O revisor foi retomado após uma interrupção de limite de uso e concluiu seu parecer; não houve segunda revisão após as correções.
