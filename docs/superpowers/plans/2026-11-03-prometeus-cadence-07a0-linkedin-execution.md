# 07A.0 — Viabilidade e capacidades do LinkedIn (plano de execução)

Data: 03/11/2026. Baseado no [plano de tarefas](2026-10-27-prometeus-cadence-07a0-linkedin-feasibility.md) e no [desenho da área](../specs/2026-10-27-prometeus-cadence-linkedin-design.md). Este plano registra os ajustes ao executar.

## Objetivo

O 07A.0 é um gate. Ele entrega:
- a decisão de viabilidade documentada;
- a matriz de capacidades por ação observada na referência;
- a trava que desliga qualquer ação do LinkedIn sem capacidade comprovada.

Ele não conecta contas, não contrata fornecedor e não envia nada.

## Ajustes ao plano de 27/10

- **Migração:** a 096 reservada já foi usada; a deste pacote é a **100**.
- **Arquivos do servidor:** `provider-contract.ts` e `admin.ts` viram um só, `src/server/linkedin/capabilities.ts`, mais o `http.ts` da rota. Não existe ainda um adaptador real para justificar a separação.
- **Permissões:** `permissions.ts` não muda. Ler as capacidades exige ser membro; atestar ou revogar um adaptador usa a autoridade da plataforma do 06IA (`app.platform_ai_authority`).
- **GET `/api/linkedin/capabilities`:** entra já neste pacote, só leitura e sem segredos. A tela precisa dele para mostrar o motivo real da indisponibilidade.

## Contrato

- **Perfil do adaptador:** fica em `app.linkedin_capability_profile`, no nível da plataforma e sem workspace.
  - Só um adaptador ativo de cada vez.
  - Campos: tipo (`official` ou `account-connector`), referência do contrato, capacidades, evidências, validade (até 400 dias), revogação e revisão.
- **Capacidades efetivas:** nenhum adaptador ativo, um vencido ou um revogado resulta em tudo desligado. O vencimento é calculado no banco com `now()`.
- **Atestar:**
  - Exige evidência para cada capacidade ligada.
  - O tipo `official` nunca pode ter mensagem `automatic`, porque a API Messages exige ação afirmativa do membro e exclui envio agendado.
  - Login OAuth sozinho (`connect`) não liga convite nem mensagem.
- **Trava:** `requireLinkedinCapability(c, action)` lança 409 `LINKEDIN_UNAVAILABLE` com o motivo. É ela que os executores do 07A.1 a 07A.3 vão chamar antes e depois de cada I/O.
- **Inventário:** cada ação observada na referência (EV-235 a EV-244) mapeia para uma capacidade. Ação sem capacidade fica bloqueada com motivo; uma ação ausente do mapa falha no teste.

## Tarefas

1. RED unitário em `tests/07a0-linkedin-feasibility.test.ts`, depois o domínio `src/domain/linkedin-capabilities.ts`.
2. RED de integração em `tests/integration/07a0-linkedin-feasibility.test.ts` cobrindo:
   - OAuth sem convite e mensagem;
   - atestado vencido ou revogado bloqueando a trava;
   - oficial com mensagem automática recusado;
   - inventário completo;
   - autoridade e HTTP (401, 403, 422, 409).
   Depois a migração 100, o serviço e a rota.
3. UI: o pré-requisito 1 e os modais "indisponível" mostram o motivo vindo do servidor. Geometria inalterada.
4. Decisão: `docs/validation/07a0-linkedin-feasibility.md` com a comparação entre a API oficial e os conectores de conta, com custo, permissões e risco, e a recomendação. A escolha e a contratação ficam com o usuário.
5. Revisão independente, correções RED→GREEN na 100a, QA no navegador, suítes completas, docs e KB.
