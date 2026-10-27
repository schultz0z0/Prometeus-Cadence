# Contratos técnicos compartilhados da baseline 27/10

## Status e arquitetura adotada

Desenho técnico próprio alinhado ao [PRD](2026-10-27-prometeus-cadence-complete-prd.md). Novos nomes abaixo são contratos a implementar, não APIs existentes. Planos individuais indicam arquivos Create/Modify, tipos, testes e dependências. Escolha técnica do agente: evolução do monólitoNext/TypeScript/PostgreSQL com os workers existentes. Foi descartada reescrita/microserviços por duplicar autoridade, filas e custos sem requisito do produto. A baseline aprovada já fixa infraestrutura central, contexto privado e operação multiempresa.

Base inspecionada: Next 16.4.2/React 19.3.1, BetterAuth 1.7.12, PostgreSQL viaPG8.23.1, Zod 4.6.7, node:test e runtime contínuo. Antes de códigoNext, ler os guias locais de route-handlers/caching/deploy emnode_modules/next/dist/docs. Não atualizar dependências para seguir exemplos de documentação mais nova.

## Convenções de contratos

Reutilizar Principal de src/domain/workspace.ts, withWorkspaceTransaction de src/server/db/transaction.ts, requirePrincipal/requirePermission e AppError. Tipos novos ficam no domínio do pacote. Nas assinaturas dos planos, `Principal`, `Promise`, `Date`, `AbortSignal` e tipos existentes mantêm suas definições atuais; demais DTOs são definidos no próprio plano/desenho.

Tipos de conveniência a criar emsrc/domain/reviewed-operation.ts quando o primeiro consumidor precisar:

```ts
type Page<T> = {items:T[]; nextCursor:string|null};
type Reviewed<T> = {input:T; token:string; expiresAt:string;
  blockers:string[]; warnings:string[]; basisHash:string};
type Confirm<T> = {input:T; token:string; requestId:string};
type Versioned<T> = {id:string; revision:number; value:T};
type EvidenceRef = {id:string; url:string; fetchedAt:string;
  quote:string; hash:string; sourceVersion:string};
type EffectResult = {operationId:string;
  state:'prepared'|'accepted'|'uncertain'|'failed'|'reconciled';
  remoteId:string|null; reason:string|null};
```

Adaptar os Review já existentes via mapeamento explícito, sem mudar seu wire-format silenciosamente. `basisHash` inclui só dependências relevantes: tenant/ator, input normalizado, versão do agregado, contexto/produto, política/fonte/credencial quando aplicável. Expiração padrão 10 min como o contrato atual; confirmação revalida autoridade atual dentro da transação. Token de revisão não autentica nem substitui política de canal.

## HTTP, banco, eventos e concorrência

### Matriz de autorização por operação

As permissões abaixo são as strings reais de src/server/auth/permissions.ts; reler o papel atual dentro da transação antes de chamar requirePermission. Principal recebido como argumento não prova associação/papel atual.

| Operação | Autoridade mínima |
|---|---|
| Leitura de contatos/jobs/relatórios/pessoas/inbox | Membership atual + RLS; escopo externo pode restringir mais |
| Criar/aplicar pesquisa, pessoas, rascunhos, qualificação ou fusão revisada | data.write; cancelamento de job por operador só se for seu criador, conforme contrato atual |
| Publicar/ativar cadência ou campanha com efeitos externos | cadences.publish + capacidade do canal/provedor e revisão válida |
| Responder/preparar/aprovar resposta de conversa | messages.reply; controle de atendimento humano pelo mesmo escopo, sem ultrapassar política do agente |
| Conectar/revogar canal WhatsApp/mail/LinkedIn | channels.manage |
| Gerir conectores, webhooks, retenção, exclusão ampla e configuração/ativação de agente | workspace.settings; desligar atendimento por conversa continua messages.reply |
| Gerir membros, convites e papéis | members.manage + invariantes de último owner/capacidade |
| Registrar autorização/supressão de contato ou confirmar consentimento de follow-up | consents.manage; opt-out recebido pelo canal é aplicado pelo serviço mesmo sem interação humana |
| Preferências de aviso/read de notificação e TOTP/sessões pessoais | Identidade atual do próprio usuário; TOTP exige reautenticação/desafio; não alterar preferências/sessões de outro membro |
| Aprovar contexto do cliente | context.approve; propor edição usa context.draft |
| Cobrança/alteração comercial | owner/admin atual conforme guardSQL financeiro; não inventar um escopo billing.manage inexistente |
| Alterar Apify/LLM/perfis globais/atestação de infraestrutura | isPlatformAiAdmin(c) e registro protegido; membership do workspace cliente não basta |
| Autorizar cliente MCP | Identidade autenticada atual, consentimento do próprio usuário e interseção exata de grants/permissões; matriz MCP complementa esta |

JobLease é importado do domínio de prospecção atual; qualquer lease de novo worker deve definir job/operation id, workspace, epoch e prazo, mantendo revogação e publicação pós-I/O. PoolClient e Principal são tipos existentes, não DTOs definidos pelo payload do cliente.

- Leitura: GET autenticado/no-store, queryZod, cursor vinculado ao workspace; página padrão 50/máximo 100 salvo contrato já distinto. Mutação: POST JSON/same-origin, limites de corpo e schema estrito; jamais obter Principal do body. Erros 403/404 por política existente,409 base/revisão conflitante,422 entrada inválida,429 limite,503 capacidade indisponível; resposta segura sem segredo/payloadbruto.
- UI eMCP chamam o mesmo serviço. Integrações usam tokens curtos/escopados que resolvem Principal atual, nunca um flagadmin enviado pelo cliente. Escopos externos podem estreitar e não ampliar as permissões do usuário.
- Tabelas novas com workspace_id e RLS forçada, FKs que impedem referência cruzada e UNIQUE(workspace_id,request_id) para operações. Serviço relê associação/papel; worker usa lease/epoch e funções mínimas de claim/result, não conexãoowner genérica. Ordem de locks existente preservada.
- Migrações aplicadas 001–082 são imutáveis. Os planos reservam 083–105 na ordem indicada; confirmar ausência de colisão antes de criar. Realocar número se houver migração concorrente não muda o escopo. Nunca criar uma tabela existente só porque um plano novo a cita.
- Atualizar journal de operações via triggers na mesma transação e tipos de src/domain/operation-events.ts quando nova entidade exigir invalidation; não enfiar conteúdo pessoal no journal. Projeções ficam reconstruíveis; fontes/receipts/ledger continuam autoritativos.
- Revisões de agregado são monotônicas; comandos aceitam expectedRevision. Worker renova lease, persiste checkpoint antes/depois da operação e revalida contexto/permissão antes de publicar resultado. Repetição devolve o mesmo efeito; resposta remota incerta vai para reconciliação.

## Fontes, contexto e arquivos

Fonte central habilitada = perfil tipado + Actor/build permitido + contrato de I/O + custo/teto + readiness validada. Sem perfil disponível, retornar indisponibilidade explícita, não escolher umActor diferente sozinho. ConsultaOSetup precede nova recomendação/instalação quando disponível; sua ausência não autoriza declarar consulta concluída. Pilotar alternativa mantém requisito, mas pode registrar decisão técnica de fornecedor.

Pesquisa reutiliza providers/APIFY/WEB/CNPJ existentes, extração com proteçãoSSRF e journal. Novas redes entram por adaptadores tipados, apenas para os campos necessários; sem execução de código/instruções vindos de páginas. LLM só propõe fatos com evidência; JEV avalia, não vira fonte. Armazenar atribuição/tempo/confiança/inconclusivo separadamente de consentimento/validação de canal.

Anexos/exports: armazenamento privado atrás de interface BlobStore put/get/delete, implementação inicial em volume durável do servidor, fora depublic. IDs opacos, URLs de download assinadas expiram em 5 min e revalidam membership; não aceitar path/nome/URLremota como autorização. Limite inicial 10MiB/arquivo,5 arquivos/mensagem; PDF/PNG/JPEG/TXT com MIME/sniff, nome saneado e verificação de conteúdo conforme contrato do canal. Canal sem suporte bloqueia publicação. Transporte do provedor não recebe um path arbitrário indicado pelaLLM.

## Runtime, quotas e instrumentos

Reaproveitar scripts/runtime-supervisor.ts, runtime-lane.ts e os loops atuais. Novas tarefas usam ticks seriais limitados, cancelamento e shutdown; nenhum setInterval por cliente ou processo visível. Limites globais de fornecedor e reservas por tenant são atômicos. Defaults de novos polls:15 s, backoff até 60 s, pausa ao ocultar/offline; eventos não apagam rascunhos. Deadlines de leitura 15 s existentes permanecem. Páginas grandes não exigem snapshot completo de todos os dados.

Critérios de operação próprios propostos: job de pesquisa com teto já existente 500 leads, máximo 10 páginas externas por empresa por rodada e perfil desabilitado sem teto financeiro finito. Resultado parcial é útil e revisável. Novos serviços definem TTL/retries na spec de área; nunca retry de envio incerto sem mecanismo de idempotência/prova.

## UI/UX e critérios de verificação comuns

Para cada plano: enumerar rotas + abas/menus/popups/campos e estados do inventário; usar componentes/CSS de referência existentes, não uma nova estética. Comparar 1920×855 e 390×844; checar 320 px sem overflow;08A amplia para 768/1440/tema/texto/teclado. Unknown da referência permaneceunknown. Evidência local pode comprovar contrato próprio sem comprovarbackend remoto.

Fluxo de tarefa: testeRED verificando comportamento → implementação mínima → GREEN → revisão das interfaces → commitlocal focado. Executores nativos usam skills executing-plans/verification-before-completion aplicáveis. Não escrever testes que apenas procurem strings de implementação. Em integração, registrar a nova suíte na allowlist de scripts/test-integration.mjs antes de rodar; nunca apontar o runner para banco operacional.

Comandos comuns:

```text
rtk proxy node --experimental-strip-types --test tests/<suite>.test.ts
rtk proxy node scripts/test-integration.mjs <suite>
rtk proxy npm test
rtk proxy npm run test:integration
rtk proxy npm run build
rtk proxy npm run typecheck
rtk proxy git diff --check
```

`<suite>` nesta convenção é substituído pelos nomes exatos de cada plano. PrimeiroRED deve falhar pela ausência do comportamento, não por syntax/import aleatório. A migração de produção só ocorre na liberação autorizada; integração cria bancoisolado `_test`. Documentação não exige iniciarDocker nem executar suites de produto nesta sessão.

Aceite gera docs/validation/<pacote>.md e evidence/<pacote>/ com resultado de testes, versões, rotas/estados/viewports, falhas/correções, efeitos reais/controlados/não testados, teardownQA e saldo/política restaurados. Não commitar.env/cookies/chaves/screens comdadospessoais.

## Entradas externas e mudança sem reabrir o produto

Provider credentials, OAuth approval, orçamento de piloto, domínio/host, política jurídica definitiva e destinos próprios são entradas de operação listadas nos planos; contrato e comportamento de ausência já são definidos. Alternativa de fornecedor exige registrar capacidade/permissões/custo/evidência e equivalência do resultado, mantendo gates de envio/cobrança. Não marcar o requisito operacional aceito enquanto apenas fallbackassistido ou teste controlado estiver disponível.
