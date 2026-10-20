# Prometeus Cadence — Identity and Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o armazenamento demonstrativo como modo principal por contas reais, sessão, workspaces, papéis e dados persistentes no PostgreSQL local, demonstrando isolamento entre dois clientes.

**Architecture:** Next.js permanece como aplicação e backend. PostgreSQL roda em um projeto Docker Compose exclusivo. Better Auth auto-hospedado cuida de identidade e organizações; autorização de negócio e transações ficam em uma camada de acesso ao servidor. A interface consome comandos assíncronos autenticados; não envia snapshots completos para substituir o banco.

**Tech Stack:** Node 24, Next 16.4.2 e React 19.3.1 existentes; PostgreSQL 18 em imagem oficial com tag/digest fixados na execução; Better Auth 1.7.12, `pg` 8.23.1, Zod 4.6.7 e Nodemailer 10.1.7, versões consultadas em 20/10/2026 e a fixar no lockfile. MailHog local reutiliza a imagem já instalada, em container próprio. Não adicionar Redis neste marco.

**Spec:** `docs/superpowers/specs/2026-10-20-prometeus-cadence-design.md`, aprovada; entrega 02 em `2026-10-20-prometeus-cadence-roadmap.md`. O usuário escolheu infraestrutura local/Docker em 20/10/2026: “postgresql ou redis algo assim”. Este plano concretiza essa escolha e aguarda revisão antes do código. Método nativo preservado da autorização anterior.

## Global Constraints

- “Uma interface navegável isolada será um marco intermediário, nunca apresentada como SaaS integral concluído.”
- “A identidade do workspace não vem de um parâmetro de cliente sem validação da sessão.”
- “Cada mutação valida autorização, schema, versão e idempotência.”
- “Nenhuma geração ativa envios.”
- “Correções humanas prevalecem sobre releituras e ficam versionadas.”
- Preservar a UX e os tokens do marco 01; usar a referência de login já fornecida. Não alterar a conta do concorrente.
- Banco local exclusivo; não reutilizar credenciais, bancos ou volumes de Chatwoot/CRM ou de outros projetos.
- Aplicação em `127.0.0.1:3210`; banco em `127.0.0.1:55432`; captura de e-mails em `127.0.0.1:1125` / UI `127.0.0.1:8125`. Verificar as portas e, se ocupadas, registrar substituição por porta livre; não parar serviços alheios.
- Segredos aleatórios em `.env.local`, ignorado pelo Git; `.env.example` só com nomes/placeholders. Nenhum segredo, senha, token ou URL de recuperação em logs ou respostas de domínio.
- Recuperação, verificação e convite enviam somente ao capturador SMTP local; nenhum e-mail externo é autorizado neste marco.
- Não contratar serviços, publicar, conectar canais de prospecção ou ativar cobrança. OAuth Google fica configurável e indisponível sem credenciais próprias.
- Preservar o demonstrativo e seu localStorage; nunca importar os dados automaticamente para a primeira conta real.
- Comandos com `rtk`; ler documentação da versão instalada de Next antes das alterações relevantes.

## Review Focus

1. Dois usuários em organizações distintas usam o mesmo ID de registro, tentam ler/gravar o ID alheio e trocam de organização durante uma requisição: nenhum dado cruza clientes nem permanece na tela após a troca.
2. Duas abas confirmam ou salvam simultaneamente, uma requisição é repetida após timeout e outra tem revisão antiga: confirmação é idempotente, conflito não sobrescreve edição e erro não comunica sucesso.
3. Usuário removido ou rebaixado ainda tem cookie/snapshot aberto: a próxima leitura/mutação revalida associação e papel; esconder botões não é a autorização.
4. Sessão vence ou rede/banco cai durante importação e confirmação: nenhuma transação parcial, formulário continua disponível e retry não duplica entidades.
5. Pool reutiliza uma conexão entre workspaces, ou falta contexto RLS: contexto é transacional e não vaza; papel de runtime não contorna as políticas. Links de recuperação/convite são temporários, vinculados à identidade correta e não reutilizáveis.

## Base observada e escolhas próprias

- A engenharia reversa observou login por e-mail/senha, Google, recuperação, conta/fuso, membros e segurança como superfícies. Não revelou o banco, o modelo de tenancy nem os mecanismos privados de sessão do CadenceFlow.
- Evidência estática preservada: resumo REA `ev_ea4a30cc326932f75c7afa5518dc4f35deb906fb7b97ed624b91de57fa8121d9`, derivado de `ev_e8eae179bb5553eb190ece6f336d2e253ae609c3a408cbcb55ff1a50c2795a2b`; limites em `docs/reverse-engineering/README.md`. A nova sessão REA 6.7.0 está conectada, sem os registros antigos em memória; usar os arquivos preservados, sem alegar nova observação autenticada.
- PostgreSQL/Docker é escolha do usuário, não inferência sobre o concorrente. Banco relacional atende identidade, relações, unicidade e transações; Redis não será banco principal e só será avaliado quando existir trabalho de fila/cache.
- Autenticação auto-hospedada com biblioteca: escolhida para reaproveitar fluxos de sessão, verificação e organizações. Serviço externo adicionaria infraestrutura que o usuário não escolheu; protocolo de autenticação próprio ampliaria trabalho sensível sem benefício para a UX.
- `setup-agent` não expõe ferramentas nesta sessão e a nova tentativa de `tools/list` retornou HTTP 401. A consulta ao acervo não foi concluída, não é um resultado vazio. Nenhuma skill/plugin/MCP novo será criado ou instalado. Docker e a imagem MailHog existentes são reaproveitados; as bibliotecas de aplicação acima são dependências do produto, não novos conectores do agente.

## Contratos compartilhados

**Identidade:** `Role = 'owner'|'admin'|'operator'`; `Principal {userId:string,workspaceId:string,role:Role,sessionId:string}`. `requirePrincipal(requestHeaders:Headers):Promise<Principal>` lê sessão e associação atuais no servidor. `requirePermission(principal,permission):void` aplica matriz abaixo. Não aceitar `role`, `userId` ou `workspaceId` do corpo como autoridade.

**Permissões:** todos os membros leem e editam leads, templates, cadências e automações preparadas; operador pode salvar contexto como rascunho. Admin/proprietário aprovam contexto e alteram configuração do workspace; admin gerencia convites/remoção de operadores. Somente proprietário promove/rebaixa administradores. Não implementar remoção/rebaixamento do último proprietário, transferência de titularidade ou exclusão de workspace neste marco. Perfil pessoal é editável pelo próprio usuário.

**Dados:** reutilizar entidades de `src/domain/model.ts`, com `WorkspaceData` como nome do contrato e alias temporário `DemoState` para compatibilidade. Preferências pessoais e do workspace têm armazenamento separado; `accountName`/e-mail vêm da identidade autenticada. `WorkspaceSnapshot {workspaceId:string,revision:number,data:WorkspaceData,capabilities:Permission[]}`.

**Comandos:** união discriminada `WorkspaceCommand` para `lead.upsert`, `leads.import`, `leads.delete`, `cadence.saveDraft`, `context.saveDraft`, `context.approve`, `template.save`, `template.delete`, `automation.save`, `audience.confirm`, `preferences.update`, `demoJob.record`. Cada variante deriva seus argumentos dos métodos atuais do repositório, com schema estrito e limites no servidor. `reset()` é exclusivo do modo demonstrativo, não existe como comando autenticado.

**Envelope:** `{requestId:string,expectedRevision:number,command:WorkspaceCommand}`. `executeWorkspaceCommand(principal,envelope):Promise<{snapshot:WorkspaceSnapshot,result?:ConfirmationResult}>`. Mesmo requestId/corpo retorna o resultado persistido; mesmo requestId com corpo diferente retorna 409. Deduplicação é consultada antes do teste de revisão para retries de confirmação já concluída. Respostas: 401 sessão ausente/vencida, 403 permissão, 404 registro fora do workspace/ausente, 409 conflito, 422 validação, 503 banco indisponível. Sem detalhes SQL para o cliente.

**Cliente:** `WorkspaceClientRepository` expõe snapshot/subscribe e mutações que retornam Promise. `useAction` assíncrono aguarda a mutação antes de toast, navegação e fechamento. Todos os consumidores serão migrados; nunca testar uma Promise como booleano. O repositório local síncrono fica apenas como implementação do modo demonstrativo e teste das transições puras.

## Estrutura

- `compose.yaml`, `.env.example`, `scripts/local-env.mjs`: ambiente exclusivo e segredos locais sem sobrescrita.
- `scripts/test-integration.mjs`: aceita nomes de suítes `migrations`, `auth`, `memberships`, `tenancy`, `commands`, `client`; sem argumentos roda todas. Seleciona arquivos explícitos, carrega URLs de teste e recusa nomes de banco sem sufixo `_test`. O processo Node de integração usa `--conditions=react-server` para módulos `server-only`; imports internos testáveis usam caminhos relativos compatíveis com o runner.
- `db/migrations/`: SQL versionado de auth e domínio; `scripts/db-migrate.mjs`: runner com lock/advisory lock e checksum.
- `src/server/db/{config,pool,transaction}.ts`: pools e transações de autenticação/domínio separados; módulos somente servidor.
- `src/server/auth/{auth,principal,permissions,mail}.ts`, `src/lib/auth-client.ts`: biblioteca, sessão, autorização e SMTP local.
- `src/server/workspaces/{service,repository,commands,schemas}.ts`: organizações, persistência e comandos.
- `src/domain/{workspace,commands}.ts`: contrato de snapshot e transições puras reutilizáveis, sem credenciais ou imports de servidor.
- `src/client/workspace-repository.ts` e `src/client/workspace-provider.tsx`: transporte, estado e tratamento de falhas.
- `src/modules/auth/`, novas rotas públicas e `src/modules/settings/{members,security}.tsx`: conta real e administração.
- `tests/server/` e `tests/integration/`: testes contra banco descartável do próprio projeto; preservar os 31 testes atuais.

## T1 — Ambiente local e migrações

**Files:** criar compose/config/runner acima; alterar `.gitignore`, `package.json`, `package-lock.json`.
**Interfaces:** `createPools(config):{authPool:Pool,appPool:Pool,close():Promise<void>}`; `withWorkspaceTransaction<T>(principal:Principal,fn:(client:PoolClient)=>Promise<T>):Promise<T>`. Banco principal `prometeus_cadence`, teste `prometeus_cadence_test`. Roles separadas: migrador/owner, autenticação e aplicação; runtime sem superuser/BYPASSRLS.

- [ ] RED: teste de migração duas vezes mantém versões/checksums e não apaga dados; divergência de checksum falha; rollback não deixa tabela parcialmente migrada. `rtk npm run test:integration -- migrations` deve falhar antes do runner.
- [ ] Criar Compose exclusivo `prometeus-cadence`, volume persistente e healthcheck `pg_isready`. Fixar imagem PostgreSQL 18 em patch/digest existentes no registry antes de subir; montar `/var/lib/postgresql`, conforme imagem oficial 18+. MailHog usa digest da imagem existente e rede/portas próprios. Não adicionar Redis.
- [ ] Gerar `.env.local` somente se ausente, sem imprimir valores; URLs para roles distintas e SMTP local. Instalar dependências fixadas; não executar CLI com `@latest`.
- [ ] Criar runner de migração, roles/base e harness de integração com whitelist de suítes e validação das URLs de teste. Auth é migrado em T2, depois da configuração da biblioteca; domínio em T4. Healthcheck expõe somente disponibilidade.
- [ ] GREEN: testes de migração passam; reiniciar container preserva registro de teste; `rtk docker compose config --quiet` passa. Commit `feat: add isolated local postgres infrastructure`.

## T2 — Cadastro, sessão e recuperação reais

**Files:** criar `src/server/auth/*`, `src/lib/auth-client.ts`, `src/app/api/auth/[...all]/route.ts`, páginas `/login`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password`, estilos de auth.
**Interfaces:** Better Auth com PostgreSQL e plugin de organizações; sessão de 7 dias, atualização após 24h, cache de cookie de sessão desativado para revalidação. Cookie HttpOnly, SameSite=Lax, Secure em HTTPS; origem confiável exata e callback apenas interno. Senha 12–128 caracteres; verificação de e-mail obrigatória antes do workspace.

- [ ] RED: cadastro/e-mail duplicado normalizado, login inválido, sessão expirada/revogada, logout, origem indevida, callback externo, recuperação consumida/expirada. Limite de login de 5 tentativas/60s por chave controlada pelo servidor; testar 429 e expiração do limite.
- [ ] Implementar fluxos com biblioteca fixada e erro uniforme para solicitar recuperação de conta existente/inexistente; nunca expor hash ou token no DTO. Verificar sessão no servidor em cada endpoint protegido, não apenas no layout.
- [ ] Gerar/revisar o SQL de auth e organizações usando o schema da biblioteca fixada; salvar em `db/migrations/` e aplicar pelo runner de T1. Não depender de geração ou migração automática em cada inicialização do app.
- [ ] E-mails de verificação/recuperação vão para MailHog local. Testes acessam o capturador local e abrem links de uso único. Google só é habilitado com client ID/secret próprios; sem configuração mostrar requisito, sem falso sucesso.
- [ ] GREEN: `rtk npm run test:integration -- auth`; navegador cadastra usuário, verifica e-mail local, entra, sai e recupera senha. Commit `feat: add self hosted account authentication`.

## T3 — Organizações, papéis e convites

**Files:** criar principal/permissions e workspace service; `/onboarding/workspace`, seletor na shell, `/settings/seats`, aceitação de convite; migrações de perfil/preferências.
**Interfaces:** `requirePrincipal`, `requirePermission` e matriz declarada. `ensureWorkspaceForOwner(userId,requestId,name):Promise<workspaceId>` provisiona organização + associação + configurações vazias de forma recuperável/idempotente; se autenticação já criou o usuário, falha no provisionamento retorna onboarding retomável.

- [ ] RED: criação concorrente/retry, operador tentando elevar papel, admin tentando alterar proprietário/admin, usuário removido usando sessão anterior, convite para outro e-mail, convite expirado/reutilizado, troca para organização alheia. `test:integration -- memberships` deve falhar antes do serviço.
- [ ] Implementar organizações com plugin da biblioteca e matriz explícita, auditando ações administrativas. Revalidar associação em cada leitura/escrita; novas contas começam vazias, sem leads fictícios.
- [ ] Convites no SMTP local, vinculados a e-mail verificado e aceitos após login. Troca de workspace invalida snapshot/cache anterior e cancela/ignora respostas da organização antiga.
- [ ] GREEN: testes e navegador com owner/admin/operator. Commit `feat: add workspaces roles and membership management`.

## T4 — Persistência de domínio e isolamento PostgreSQL

**Files:** criar migrações de domínio, server repository/commands/schemas e transições puras reutilizadas.
**Interfaces:** `readWorkspaceSnapshot(principal):Promise<WorkspaceSnapshot>` e `executeWorkspaceCommand`. Tabelas de listas, leads, templates, contexto/versionamento, cadências, automações, preferências, jobs demonstrativos, idempotência e auditoria. IDs existentes são text; chave de registro e FK incluem workspace. Settings/steps/filtros podem ser JSONB validados, sem snapshot único substituível.

- [ ] RED: A/B com IDs iguais; leitura/escrita cruzada e FK para lista alheia falham; papel runtime sem contexto vê zero dados; contexto não vaza pelo pool. Testar rollback da confirmação e importação, revisão obsoleta, retry após resultado persistido e chave repetida com corpo diferente.
- [ ] Implementar `ENABLE/FORCE ROW LEVEL SECURITY`, índices iniciados por workspace e policies `USING/WITH CHECK`; contexto por `set_config(...,true)` dentro da mesma transação/conexão, nunca em `pool.query` separado. Verificar membership/role antes de abrir a operação.
- [ ] Reutilizar regras puras do marco 01; servidor impõe status de rascunho/pausado, limite de importação de 500 registros por comando e limite de corpo de 2 MB, preserva edição humana e confirma público em uma transação. Não aceitar ativação/envio por troca de campo.
- [ ] Idempotência salva hash canônico da operação e resultado no mesmo commit. Incrementar revisão por mutação; auditoria sem corpos sensíveis. Preferências de usuário não ficam compartilhadas com outros membros.
- [ ] GREEN: `rtk npm run test:integration -- tenancy commands`; reiniciar app/banco e reabrir em sessão diferente mantém os dados. Commit `feat: persist workspace data with transactional isolation`.

## T5 — Transporte autenticado e migração da interface

**Files:** criar `/api/workspace/snapshot`, `/api/workspace/commands`, client repository/provider; alterar layout e consumidores de `useDemo/useRepository/useAction` em todos os módulos.
**Interfaces:** envelopes e client repository acima. Cache privado por workspace, `no-store` nas leituras autenticadas; fila local ordena gravações da mesma aba. 409 mantém formulário, atualiza base e pede reaplicar; 401 mantém edição temporária e oferece reautenticação.

- [ ] RED: Promise rejeitada não exibe sucesso/navega; dois cliques em confirmação manual/IA, resposta de workspace antigo chega depois da troca, falha em importação não altera snapshot, 409 não faz retry cego com overwrite.
- [ ] Migrar todos os callbacks para `await`; operação manual usa requestId estável e compartilha Promise em curso, liberando retry após falha. Publicar snapshot somente após resposta validada do servidor.
- [ ] Layout verifica identidade e carrega snapshot autorizado. `/login` redireciona autenticado com workspace; sem workspace vai ao onboarding. Demonstrativo continua disponível apenas por modo explícito `APP_DATA_MODE=demo`, com banner claro e sem chamadas ao banco; modo principal é `server` e não faz fallback silencioso para demo.
- [ ] GREEN: suíte atual + client/integration. Navegador grava contato, automação e cadência em conta A, recarrega e abre outra sessão; conta B permanece vazia. Commit `feat: connect application workflows to authenticated persistence`.

## T6 — Conta, membros e segurança na UX existente

**Files:** alterar shell, account/settings, criar members/security e componentes de estados de sessão/permissão.
**Interfaces:** DTO pessoal separado de configuração do workspace; capability server-driven só orienta UI, nunca substitui autorização. Sessões listadas com metadados mínimos; revogação própria/outras exige identidade atual.

- [ ] RED: operador tenta salvar configuração administrativa via HTTP direto; atualização de perfil pessoal não altera membro diferente; última associação de owner não pode ser removida; dados de sessão não incluem tokens.
- [ ] Implementar perfil, e-mail autenticado, fuso, nome da organização, membros, convites locais, mudança de papel permitida, logout, sessões e troca de senha. Preencher estados vazios de contas novas sem alegar que já criaram cadência/lista.
- [ ] Ajustar textos “salvo neste navegador” somente para dados demonstrativos/simulações. Preservar avisos de provedores desconectados, assinatura pendente e nenhum envio real. Não migrar automaticamente localStorage da demonstração.
- [ ] GREEN: testes e fluxo owner/admin/operator no navegador; comparação de login com print U01 e formulários do marco 01. Commit `feat: add account and security management workflows`.

## T7 — Aceite e documentação do marco

**Files:** criar `docs/validation/02-identity.md`, capturas próprias, atualizar README e roteiro.

- [ ] Rodar `rtk npm test`, `rtk npm run test:integration`, `rtk npm run typecheck`, `rtk npm run build`: todos exit 0. Integração usa banco de teste nomeado e rejeita URL do banco principal; nenhuma limpeza destrói volume alheio.
- [ ] Testar duas sessões reais: cadastro/verificação/login; criar workspace; persistir lead/template/automação/cadência; recarregar/reiniciar; convidar operador e negar ação administrativa; remover membro; confirmar isolamento de B e reutilização de conexão sem contexto antigo.
- [ ] Smoke adapta-se às rotas protegidas: 401/redirect esperado sem sessão, 200 com sessão; não reutilizar o aceite antigo de “todas públicas”. Conferir payload/HTML sem hash, segredo ou dados do outro cliente.
- [ ] Revisão independente única do conjunto conforme execução nativa, correções com RED→GREEN; declarar limites de infraestrutura local e OAuth sem credenciais. Registrar tag/digest real das imagens, versões, migrações e comando de retomada.
- [ ] Commit `test: verify authenticated workspace isolation and persistence`.

## Auto-revisão e limites

- O aceite 02 é conta real + dois clientes isolados + servidor persistente. Prospecção/IA/envios/billing continuam nos marcos seguintes.
- Os contratos síncronos do marco 01 serão mantidos apenas no demonstrativo; a migração assíncrona de todos os consumidores é obrigatória, não uma alteração cosmética do provider.
- RLS não substitui membership/role nem a validação por comando. A credencial runtime não é a do migrador.
- Snapshot inicial ainda pode retornar as entidades do workspace inteiro; este marco não promete escala de milhões de leads. Paginação/busca de alto volume será feita no marco de geração antes da carga real; não usar um único JSON de workspace como banco.
- Um único proprietário inicial e convites são suficientes. Não incluir billing, SSO empresarial, MFA, transferência de titularidade, exclusão de organização ou deploy neste marco.
- Todos os cinco riscos de Review Focus têm testes explicitamente atribuídos a T2–T5. Nenhuma dependência exige contratação de serviço ou contato externo.

## Referências técnicas consultadas

- [Next.js: autenticação e camada de acesso](https://nextjs.org/docs/app/guides/authentication), também lida na versão instalada.
- [Better Auth: instalação](https://better-auth.com/docs/installation), [organizações](https://better-auth.com/docs/plugins/organization), [e-mail e senha](https://better-auth.com/docs/authentication/email-password).
- [Docker: PostgreSQL e persistência](https://docs.docker.com/guides/postgresql/).
- [node-postgres: transações na mesma conexão](https://node-postgres.com/features/transactions).

## Handoff

Plano escrito e revisado internamente; implementação 02 ainda não iniciada. O usuário já escolheu execução nativa e PostgreSQL/Docker. A revisão deste plano é a próxima etapa requerida por `superpowers:writing-plans`; preservar o método escolhido e não pedir essa escolha novamente.
