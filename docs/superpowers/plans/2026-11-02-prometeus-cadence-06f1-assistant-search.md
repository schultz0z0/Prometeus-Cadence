# 06F.1 — Busca global e assistente de ajuda e conta

Data: 02/11/2026. Execução do [plano 06F](2026-10-27-prometeus-cadence-06f-assistant-experience.md) dividida em dois pacotes, como em 06E.1/06E.2:

- **06F.1 (este):** busca global com dados do workspace, assistente lateral fiel à referência (respostas pela ajuda local e pelos fatos da conta, card "Pra hoje", sugestões, suporte), manifesto de ajuda local e Central de Ajuda com destinos reais.
- **06F.2:** os 4 comandos propostos com revisão/confirmação (`/api/assistant/:id/{prepare,confirm,cancel}`), `onboarding_progress` persistido, tours por rota e os menores herdados (06B.3, 06B.5, popup 06D.2).

## Referência

- Assistente: [EV-267](../../reverse-engineering/visual-2026-10-25/evidence/EV-267-assistant-roadmap-gap.json) e capturas `reference-{desktop,mobile}-overlay-assistant.png`. Painel flutuante à direita, abaixo do topo, sem escurecer a página. Cabeçalho com avatar, título, subtítulo, botões "nova conversa" e fechar. Card "Pra hoje · N" recolhível com o item, o texto, a ação e "Perguntar". Boas-vindas "Como posso ajudar?", texto e uma sugestão em pílula. Composer com botão de enviar e rodapé "Com base na Central de Ajuda e na sua conta", com links Central de Ajuda, Suporte por e-mail e Falar com vendas.
- Busca: captura `reference-desktop-overlay-global-search.png`. Modal no topo, placeholder "Buscar lead, cadência ou página…", dica vazia e rodapé de teclas (↑↓ navegar, Enter abrir, Esc fechar).
- O componente de chat da referência não está nos bundles retidos. As respostas, o modelo e o backend dela não foram observados.

## Contrato

- `GET /api/search?q&kinds&cursor` retorna leads (nome, e-mail, telefone, empresa), listas e cadências do workspace ativo. A paginação usa cursor por chave. As páginas do app continuam no cliente. Termo com menos de 2 caracteres → 422.
- `GET /api/assistant` retorna a última conversa do usuário no workspace, o card "Pra hoje" calculado pelos fatos e a disponibilidade da IA.
- `POST /api/assistant {threadId?, text, contextRoute, requestId}` grava a pergunta, monta as fontes autorizadas (artigos do manifesto e fatos da conta) e chama a IA central da política do workspace (somente provedores HTTP). A saída é validada com Zod, e as citações precisam pertencer às fontes. A resposta é gravada só depois de revalidar a sessão e a associação. Sem rota, com falha ou com saída inválida, responde pelo melhor artigo do manifesto com o aviso de que a IA não respondeu. Repetir o `requestId` devolve a mesma resposta.
- Limite próprio: 30 perguntas por usuário por dia e 200 por workspace por dia, travado em SQL.
- Nenhuma mutação de produto. Pedidos de ação recebem a explicação e o destino real.

## Persistência

Migração `093-assistant-experience.sql`: `assistant_thread` e `assistant_message`, com RLS por workspace **e** usuário. A função `app.assistant_ask` faz o lock, aplica o limite e garante a idempotência. Sem credenciais nem segredos no histórico.

## Testes

- Unitário: `assistantActionAllowed`, busca no manifesto e validação/citações da saída da IA.
- Integração:
  - busca isolada por tenant, sem resultado de conteúdo excluído e com paginação;
  - conversa isolada por usuário;
  - resposta com a IA injetada e citações filtradas;
  - injeção na pergunta sem mutação;
  - fallback sem rota;
  - limite diário;
  - idempotência;
  - membro removido durante o I/O não grava a resposta;
  - HTTP 401/422.
