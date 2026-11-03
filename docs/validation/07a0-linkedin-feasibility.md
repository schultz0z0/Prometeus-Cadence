# 07A.0 — Viabilidade e capacidades do LinkedIn

Data: 03/11/2026. Estado: gate concluído local/controlado. **Rota decidida pelo usuário em 03/11: conector de conta, com a Unipile** ([revisão](07a0-linkedin-feasibility-review.md)). [Plano de execução](../superpowers/plans/2026-11-03-prometeus-cadence-07a0-linkedin-execution.md).

Este pacote não conecta contas, não contrata fornecedor e não envia nada. Ele entrega três coisas:
- a matriz de capacidades;
- a trava que desliga toda ação sem capacidade comprovada;
- a comparação para a decisão.

## O que a referência mostra

O módulo LinkedIn da referência (EV-235 a EV-244) opera a conta do próprio cliente:
- busca de público por filtros, por link de busca e por engajamento em post;
- convite com nota de até 300 caracteres, ritmo diário e retirada depois de N dias;
- aquecimento: visitar o perfil e curtir um post;
- aceite que vira pessoa, lista e pipeline;
- cadência de mensagens para quem aceitou;
- respostas na caixa;
- comentário em post, aprovado antes de sair.

O pré-requisito observado é "Assinar o plano" seguido de "Conectar o seu LinkedIn" (EV-238). O texto fala em "ritmo seguro da sua conta" e "cota da semana". `[inf]` Esse vocabulário é típico de um conector que opera a conta do usuário, não da API oficial. O backend da referência não foi observado.

## Matriz por ação

São 20 ações observadas, em `linkedinInventory` (`src/domain/linkedin-capabilities.ts`). Cada uma precisa de uma das capacidades abaixo. Três não dependem da conta LinkedIn e ficam em "local": filtros com IA, trecho da nota com IA e templates.

| Capacidade | Ações | API oficial | Conector de conta |
|---|---|---|---|
| `connect` | conectar a conta | Sim: Sign In with LinkedIn (OIDC), self-service. Só identifica o membro | Sim: autenticação hospedada pelo fornecedor |
| `audience` | filtros, link de busca, post, explorar | Não: busca de perfis é de parceiro fechado | Sim |
| `invite` | convite com nota, ritmo, retirada | Não: Invitations API restrita a parceiros aprovados [SRC-004] | Sim, com limite da própria conta (~100/dia, ~200/semana em conta paga) [SRC-007] |
| `acceptance` | aceite, pipeline, enriquecimento no aceite | Não | Sim, por sincronização ou webhook |
| `readMessages` | respostas na caixa | Não | Sim |
| `sendMessage` (assistido) | responder a conversa | Só parceiro aprovado, com ação afirmativa do membro e rascunho editável [SRC-005] | Sim |
| `scheduledMessage` | cadência para quem aceitou | **Proibido**, mesmo para parceiro: "member actions do not include an automated or scheduled event" [SRC-005] | Sim |
| `profileVisit`, `like` | aquecimento | Não | Sim |
| `comment` | comentário aprovado | Não, para perfil pessoal de terceiros | Sim |

## As três rotas

1. **Só a API oficial.**
   - Fica viável apenas o login.
   - Convites, mensagens, busca e aceite exigem programa de parceiro fechado, sem prazo nem garantia. Mesmo aprovado, a cadência automática de mensagens continua proibida.
   - **Efeito:** o módulo LinkedIn não opera; a paridade com a referência fica bloqueada (BR-001).
2. **Conector de conta** (Unipile, Linked API, gtm-api e similares).
   - Opera tudo o que a referência mostra, pela conta que o próprio cliente conecta.
   - **Custo:** Unipile a partir de 49 EUR/mês para até 10 contas, depois de 5,00 a 3,00 EUR por conta, com chamadas ilimitadas. Linked API custa 49 ou 74 EUR por assento [SRC-006, fonte do próprio fornecedor].
   - **Risco:** o Contrato do Usuário do LinkedIn proíbe bots e métodos automatizados para enviar mensagens ou adicionar contatos [SRC-008]. A conta do cliente pode ser restringida. O risco recai sobre cada cliente e sobre a reputação do Prometeus, e é um ponto para jurídico (`Q`: termos, responsabilidade e aviso ao cliente).
3. **Ferramenta de outreach com API** (HeyReach, Expandi).
   - Também opera a conta, com o mesmo risco contratual. Custa mais por remetente.
   - O Prometeus passaria a orquestrar o produto de outro fornecedor, que também faz cadência, o que duplica autoridade e limites.
   - **Não recomendado.**

## Recomendação

Recomendo a **rota 2 (conector de conta), com Unipile como primeira avaliação**. É a única que reproduz a referência, e o custo por conta é baixo e repassável. A contratação depende do usuário, junto com estas condições:
- **Termos aceitos pelo cliente:** cada cliente aceita, ao conectar, um termo explícito sobre o risco da conta e os limites do LinkedIn.
- **Ritmo conservador:** o ritmo próprio fica mais baixo que o do fornecedor (teto inicial de 12 convites por dia, como no desenho do 07A.2).
- **Trava ativa:** nenhuma ação vai além do que a trava deste pacote permite. A habilitação vence em até 400 dias e pode ser revogada na hora.
- **Prova antes de liberar:** o atestado só liga uma capacidade depois de prová-la com uma conta própria de teste. Não basta a documentação do fornecedor.

A rota 1 continua possível como modo "assistido". Com a API oficial a trava aceita só `connect` e `sendMessage: assisted`, e recusa `automatic`.

**Decisão do usuário (03/11/2026):** rota 2, conector de conta, com a Unipile.

Antes de ligar qualquer capacidade de verdade, ainda faltam:
- **contrato e chave da Unipile**, a cargo do usuário; o agente não contrata;
- **uma conta LinkedIn de teste** do próprio usuário, para comprovar cada capacidade;
- **leitura jurídica** do termo de risco que o cliente aceita ao conectar.

O 07A.1 pode ser construído antes, com a Unipile simulada nos testes. A habilitação na plataforma só acontece depois que esses itens estiverem atendidos. Até lá o módulo continua mostrando "Nenhum fornecedor do LinkedIn está habilitado na plataforma."

## Contrato entregue

- **Tabela da plataforma:** `app.linkedin_capability_profile` (migração 100).
  - Fica sem workspace e sem grant direto para os papéis do app.
  - Um único adaptador ativo, garantido por índice parcial único e trava consultiva.
  - O tipo `official` com mensagem `automatic` é recusado também por CHECK.
- **Funções:**
  - `app.linkedin_capability_state()` é a leitura para membros, `cadence_app` e `cadence_worker`.
  - `app.attest_linkedin_adapter` e `app.revoke_linkedin_adapter` exigem a autoridade da plataforma (`platform_ai_authority`) e revisão esperada.
- **Atestado** (Zod):
  - evidência obrigatória para cada capacidade ligada, e nenhuma evidência para capacidade desligada;
  - validade entre agora e 400 dias;
  - `adapterId` restrito.
- **Leitura:** devolve capacidades efetivas, adaptador (id, tipo, validade, revisão), motivo e as 20 ações com `allowed` e motivo. O contrato, as evidências e quem atestou ficam no servidor.
- **Trava:** `requireLinkedinCapability(c, key)` lança 409 `LINKEDIN_UNAVAILABLE`. A leitura acontece na transação de quem chama, então vencimento e revogação valem na hora.
- **HTTP:** `GET/POST /api/linkedin/capabilities`. GET serve a qualquer membro; POST faz `attest` ou `revoke` e só a plataforma pode.
- **UI:**
  - **Pré-requisito 1:** mostra o motivo vindo do servidor.
  - **Com o login habilitado:** o passo 1 aparece concluído e o passo 2 diz que a conexão ainda não existe.
  - **Modais "indisponível":** usam o mesmo motivo.
  - **Geometria:** inalterada.

## Validação executada

- **Unitários:** 5/5 no arquivo do pacote.
  - Mensagem oficial é assistida, nunca agendada.
  - O login sozinho não libera mais nada.
  - Inventário completo, com evidência por ação.
  - Regras do atestado.
  - Perfil malformado bloqueia tudo.
- **Integração focada:** 8/8.
  - Sem adaptador, tudo bloqueado, com motivo.
  - Login oficial: `connect` liberado, convite e mensagem bloqueados para todos os workspaces, e nenhum segredo na leitura.
  - Oficial automático: 422 no Zod e 23514 no CHECK. Quem não é da plataforma: 403. Nenhuma linha gravada.
  - Mensagem assistida passa; mensagem agendada dá 409.
  - Vencida ou revogada: a trava dá 409 na hora. Revisão antiga: 409. Segundo adaptador ativo: 409. A revogação libera a vaga e mantém o registro.
  - Vencimento no meio da transação: a segunda checagem dá 409.
  - A tabela é inacessível ao papel do app (42501).
  - HTTP: 401 anônimo, 403 sem a plataforma, 422 inválido ou com ação desconhecida, 409 com workspace trocado, `no-store`.
- **Suítes completas:** 537/537 de integração e 393/393 unitários. Build e tipos com exit 0, `git diff --check` limpo.

## QA no navegador

Conta descartável `[RE] QA LinkedIn`, em 1920×855:
- **Sem fornecedor:** o passo 1 mostra "Nenhum fornecedor do LinkedIn está habilitado na plataforma." ([captura](evidence/07a0-linkedin-feasibility/local-linkedin-none.jpg)).
- **Modal de Nova campanha:** "Explorar público" abre o modal com o mesmo motivo; nada é criado ([captura](evidence/07a0-linkedin-feasibility/local-linkedin-unavailable-modal.jpg)).
- **Só o login habilitado** (fixture local, oficial): o passo 1 aparece concluído e o passo 2 diz "A conexão da conta ainda não está disponível" ([captura](evidence/07a0-linkedin-feasibility/local-linkedin-login-only.jpg)). Nenhum botão novo é oferecido.
- **375 px:** sem overflow horizontal.
- **Limpeza (L-036 removed):** a fixture, a conta, o workspace e as sessões foram removidos por IDs exatos. A tabela de capacidades voltou a 0 linhas.
- **Sem chamadas externas:** nenhuma chamada ao LinkedIn nem a fornecedores. A pesquisa foi feita só em páginas públicas.

## Limites

- **Decisão:** a rota, o fornecedor e o aceite jurídico são do usuário. Sem eles o módulo continua bloqueado, e esse é o estado correto.
- **Capacidades dos conectores:** vêm da documentação dos fornecedores e de uma comparação feita pela própria Unipile, que tem viés. Elas só podem ser ligadas depois de provadas com uma conta de teste própria.
- **Referência:** a fidelidade visual não mudou; só os textos dos pré-requisitos e dos modais. O passo "Assinar o plano" da referência (EV-238) continua diferente, como antes, porque o trial e o consumo pré-pago são divergências escolhidas.
- **Entrega:** sem push, merge ou deploy.
