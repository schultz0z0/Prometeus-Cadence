# Leitura do site no Contexto de IA — plano

> Execução nativa nesta sessão (mudança pequena, aprovada pelo usuário em 15/11/2026).

**Goal:** `context_read` lê até 12 páginas do site (sitemap ou links da home), priorizando serviços/produtos/preços, e todas viram fontes.

**Spec:** `docs/superpowers/specs/2026-11-15-leitura-site-contexto-design.md`

## Global Constraints
- Até 12 páginas, até 48.000 caracteres no total, no máximo 12.000 por página.
- Demais chamadores de `fetchEvidencePack` sem mudança de comportamento.

## Review Focus
- Site sem sitemap (404): cai para os links da home.
- `sitemap.xml` como índice (sitemapindex) ou redirecionado: expande um nível.
- Sitemap com URLs de outro domínio ou arquivos (PDF, imagens): ignorados.
- Falha numa página interna: pula e segue.
- Navegador indisponível ou cancelamento: propaga como hoje.

### Task 1: orçamento de site em `fetchEvidencePack`
**Files:** `src/server/prospecting/extraction/fetch-page.ts`, `src/server/prospecting/site-collection.ts` (exportar `sitemapLinks`), `tests/site-browser-cutover.test.ts`
- Produces: `fetchEvidencePack(url, options, deep=false, budget?: {pages:number; chars:number})`; `rankSiteLinks(urls:string[]):string[]`.
- [ ] Teste: SiteBrowser falso com sitemap (índice → filho) listando `/servicos`, `/servicos/a`, `/blog/x`, `/contato`, PDF e outro domínio; com `{pages:12,chars:48000}` lê home, depois serviços, depois contato, nunca PDF/outro domínio; soma ≤ 48.000.
- [ ] Teste: sitemap 404 → usa links da home.
- [ ] Teste: `rankSiteLinks` ordena serviços/produtos/planos/preços < contato/sobre < resto < blog; empate por profundidade.
- [ ] Implementar; rodar `npm test`.

### Task 2: execução e validações aceitam 12 fontes
**Files:** `src/server/planning/execution.ts`, `src/server/planning/contracts.ts`, `src/server/planning/evidence.ts`, `tests/planning-contracts.test.ts`
- [ ] Teste: `validatePlanningResult('context_read', …)` aceita 12 `public_page` e recusa 13.
- [ ] `execution.ts` chama `fetchEvidencePack(domain,{signal},true,{pages:12,chars:48000})` e usa `slice(0,12)`; tetos de 3 → 12.
- [ ] `npm test` e `node scripts/test-integration.mjs planning-pipeline`.

### Task 3: registro e verificação real
- [ ] AGENTS.md: divergência registrada.
- [ ] Reler agenciaprometeus.com.br no cadence-prod e conferir páginas de serviços nas fontes.
- [ ] Commit.
