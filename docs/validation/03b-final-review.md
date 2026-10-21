# Revisão final — marco03B

Revisão única, somente leitura, por gpt-6-astra sobre7511ca4..b0b324a. Sem subdelegação, alterações no checkout, inferências ou leitura de credenciais pelo revisor. Evidência final:92/92 testes unitários,59/59 integração PostgreSQL, typecheck/build exit0 e50/50 rotas. As correções não consumiram novas chamadas externas.

## Achados e correções

| Grau confirmado | Defeito reproduzido | Correção e regressão |
|---|---|---|
| Important | Probe ignorava app.prospecting_policy e sua revisão | workspaceProspectingConfig compartilhado; limits/version vinculados à prova; zero, consumo e mudança entre preparar/confirmar |
| Important | Primeiro success inserido na finalização renovava inferência com mais de24h | checked_at vindo do início persistido da tentativa; pausa25h não libera híbrido |
| Important | Mudança/revogação/expiração durante diagnóstico Codex ainda permitia JEV | validação final de rota/check/membership/lease após await do diagnóstico; zero decide nos três cenários |
| Important | Crash deixava prepared que não invalidava teste anterior | readConnectionCheck consulta journal da mesma rota; incerteza preservada ao reconciliar resultado indisponível; replay não infere |
| Minor, adiado | result.usage do resumo é null | total/ledger corretos; atribuição por módulo permanece pendente |

As seis regressões iniciais falharam pelos defeitos esperados. Uma regressão adicional mostrou que a proteção contra tentativa inconclusiva precisava ignorar somente o intent novo da própria chamada antes do despacho; também passou após correção. Teste de reconciliação mantém bloqueio depois de reconhecer resultado indisponível. Não houve segunda revisão: o passe de correção é verificado pelas regressões e suíte completa.

## Comportamentos que o revisor não julgou

Disponibilidade real de OpenAI/Gemini/JEV; visual mobile e sessões operator/B; qualidade empírica das classificações; OAuth hospedado/cofre por cliente e cadências/scheduler futuros. Cada decisão sobre esses limites consta no registro abaixo.

## Registro durável da execução

# SDD ledger — plan: docs/superpowers/plans/2026-10-20-prometeus-cadence-03b-ai-routing.md

User approved spec and plan, native execution on20/10/2026. Implementation BASE7511ca4, functional main76af8ef. Branch codex/ai-routing, normal repository, no attached worktrees.

Ruling: reuse existing feature-branch checkout and preview3210 per approved plan and prior user preference — preserve running local preview rather than move its data/runtime — cost: branch isolation instead of a separate checkout.
Ruling: use Windows-compatible manual ledger and extracted briefs instead of POSIX sdd helpers — same task/spec/commit record — cost: manual bookkeeping.

Pre-flight T1→T2: ConventionalRoute/type schemas/config flags supplied T1, task-based adapters T2; fingerprint remains server-only, usage.provider codex differs from route provider codex-local and must map explicitly.
Pre-flight T1/T2→T3: policy/default-null, connection checks and generic decisions replace literal-JEV assumptions; existing qualifier integration fixtures must explicitly seed policy/check in _test only.
Pre-flight T1/T3→T4: probe bypasses prior hybrid validation only through explicit conventional route; prepare pure and confirm creates all synthetic rows/job/reserve together. No new job kind necessary.
Pre-flight T4→T5: settings APIs use current workspace/origin/RBAC and stable requestId; DTOs never expose config fingerprint/keys or CLI raw output.
Pre-flight T5→T6: UI browser acceptance follows main012 migration and rebuild in T6; before that tests use only _test. Live acceptance3 calls maximum, model gpt-6.1-sol discovered, no API/source calls.
Pre-flight plan defect: scripts/test-integration.mjs has a suite allowlist; register ai-settings/ai-routing-pipeline/ai-probe when their tests are introduced, otherwise planned commands reject before assertions.
Ruling: extend the integration runner's existing allowlist with the new suites in their owning tasks — necessary for the approved verification commands — cost: one additional existing script touched.

Task1: started BASE7511ca4; brief read. Tasks2–6 pending.

T1 RED observed missing routing/settings modules; after implementation integration exposed absent workspace_meta lock target on fresh accounts and inherited app INSERT grants. Fixed by ensuring meta row before lock and explicit revocations.
Ruling: add .gitattributes LF for migrations and restore only files whose normalized hash equals the recorded database checksum — Git checkout converted006–011 to CRLF — cost: fixed LF convention for SQL files.
Ruling: migration013 explicitly revokes inherited default app writes to connection attestations —012 was already applied to _test, so preserve its checksum — cost: an additional additive migration.
Task1: complete; unit75/75, ai-settings3/3, repeated test migration0, typecheck0.
Task2: started; brief read below.
Task2: complete; missing conventional module RED observed; GREEN87/87unit,typecheck0. Adapters tested tasks/invalid/refusal/tool/network and diagnostic status; no live inference.
Task3: started; brief read below.
Task3: complete; new pipeline tests RED observed JEV requirement; GREEN87/87unit,49/49integration,typecheck0. Cases include three providers solo, no duplicate opinion, expired hybrid check, policy race before/during inference and uncertain API reconciliation.
Ruling: block new AI dispatch for legacy jobs without a frozen route and require a new reviewed job — prevents silently choosing an unapproved account/provider; historic results remain readable — cost: pending legacy AI jobs must be prepared again.
Ruling: preserve partial state when committed module items exist even before final counters are populated — RED reproduced failed instead of partial during policy race — cost: an additional scoped existence query on step failure.
Task4: started. Next installed route-handler/client boundary docs read.
Task4: complete; RED missing probe; GREEN87/87unit,52/52integration,typecheck0. Atomic concurrent probe, budget rollback, read DTO/no key and operator/origin/workspace guards verified.
Ruling: keep purpose-specific probe insertion within its authenticated transaction instead of widening the generic job API — the probe creates synthetic rows atomically while public job schemas cannot accept purpose markers — cost: a second narrow job-insert statement to maintain.
Task5: started; brief read.
Task5: complete; missing client methods RED observed; GREEN90/90unit,52/52integration,typecheck0. Rendered browser acceptance in T6 after migrations/build. Settings policy saving and tests use stable request identity; operator read-only; probe has no Apply action.
Task6: started; brief read; no live calls yet.

T6 runtime rejection: obsolete node_repl flag failed before inference. Local features list reproduced unknown feature; regression RED→GREEN removed only unsupported flag. Explicit normal reconciliation confirmNotStarted resumed probe, no extra budget.
Ruling: remove standalone JEV live smoke and use confirmed conventional probes; hybrid stays in normal reviewed jobs — JEV must never run alone — cost: hybrid smoke requires the normal job workflow.
Ruling: live QA uses UI-confirmed probe and scoped worker instead of CLI smoke because old03 needs_reconciliation fixture remains — preserve history and avoid unrelated execution — cost: smoke live command not exercised here.
Ruling: record mobile screenshot/browser operator/B acceptance as blocked after Chrome DevTools stopped responding; retain passing desktop and HTTP/RLS evidence — avoid claiming a visual check not completed — cost: mobile visual and two browser personas remain to inspect.
Task6: complete; RED smoke parser absent and unsupported CLI flag observed; GREEN92/92unit,52/52integration,typecheck0,webpack build0,50/50routes,default smoke SKIPPED. Three actual Codex calls: probe44c5f4fe completed1 and batch69846188 completed2; proposals not applied; persisted after restart. Visual caveats ruled above.

Final review: one fresh read-only gpt-6-astra reviewer examined7511ca4..b0b324a; no Critical,4Important,1Minor. All four Important regraded by user effect and accepted. No re-review.
Final: fixed probe workspace budget bypass — persisted zero/consumed budget and stale-policy confirmation test RED→GREEN.
Final: fixed late probe freshness — pause25h between persisted summary and finalization test RED→GREEN.
Final: fixed diagnosis authority window — policy change, revocation and expiry inside diagnose tests RED→GREEN; zero JEV dispatch.
Final: fixed recovered conventional uncertainty — prepared attempt and unavailable-result settlement shadow earlier success RED→GREEN, no inference replay. Added hybrid fresh-summary regression RED→GREEN so the current undispatched intent cannot block itself.
Final: minor (deferred): summary module result.usage remains null; durable job ledger and total usage are correct. Attribution per module can be completed later.
Final: Ruling: timestamp successful probes using the persisted inference attempt start, conservatively — no schema migration or late validity renewal — cost: validity ends up to the inference duration earlier.
Final: Ruling: derive an unresolved conventional connection state from the journal, ignoring only the fresh intent within its own preflight — covers process death before a catch and preserves uncertainty after unavailable-result settlement — cost: an additional scoped join per connection read and conservative blocking while another conventional attempt is active.
Final: Ruling: reviewer deferred real OpenAI/Gemini/JEV availability — contract tests stand; no additional paid calls authorized — cost: live eligibility/model compatibility remains unverified.
Final: Ruling: reviewer deferred mobile and operator/B visual sessions — desktop plus tested server/client isolation stands; browser tooling unavailable — cost: these visual inspections remain pending.
Final: Ruling: reviewer deferred empirical classification quality — synthetic test proves transport/persistence only — cost: no accuracy/calibration claim until human-labelled evaluation.
Final: Ruling: reviewer deferred hosted OAuth, per-tenant vault and future cadences/scheduler — preserve this local testing milestone scope — cost: these capabilities require later implementation.

Final correction pass complete:92/92unit,59/59PG integration,typecheck0,webpack build0,50/50routes,diff-check0. Server restarted3210; persisted successful check and total3Codex calls re-read with no inference. Four Important fixed; one Minor deferred; no re-review. Branch integration pending user choice.
