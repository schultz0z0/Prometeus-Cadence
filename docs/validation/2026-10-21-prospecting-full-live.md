# Aceite real — contratos Apify e fluxo de prospecção do marco 04

21/10/2026. Correção autorizada pelo usuário após o primeiro lead Maps. Execução no workspace **QA · Marco 04 · revisão visual** (`a801c8b3-727f-40a1-94b2-422a1a74ef34`). Credenciais somente em `.env.local`, ignorado pelo Git. Nenhuma mensagem enviada, proposta aplicada ou recorrência ativada.

## Contratos corrigidos

- Web `apify/google-search-scraper`, build `0.0.468`: idioma `pt-BR`, páginas de cerca de dez resultados, sem `resultsPerPage` inexistente. Paginação lê registros SERP além dos cinco primeiros e mantém cursor por candidato.
- CNPJ `bigdavidson/brazil-cnpj-companies`, build `0.1.2`: `uf`/`city` em arrays, `maxRecords`, `includePartners:false`. Avisos gratuitos não consomem quota de empresas; erros da fonte não viram pesquisa vazia bem-sucedida. Lookup atravessa avisos antes da empresa.
- Mapeamento de razão social, nome fantasia, município, UF e telefones do contrato cadastral real. Identidade normalizada antes da comparação, inclusive CNPJ formatado manualmente.
- Extração preserva contatos publicados no rodapé e em links mailto/tel antes do corte. Modo deep prioriza links reais de contato/sobre, com até três páginas e 12 mil caracteres agregados; DNS/redirects e transporte com IP público fixado continuam validados. Não é crawling integral do site.
- Registro cadastral pode descobrir um único CNPJ com dígitos verificadores válidos no site; múltiplos CNPJs permanecem ambíguos. Não adivinha por nome. Ausência de site não grava um resultado vazio que impediria coleta após descoberta posterior.
- Codex: caminho local atualizado, versão instalada `0.163.0-alpha.11` inspecionada e incluída na lista explícita junto da versão anterior. Versões desconhecidas continuam bloqueadas. Não houve leitura/cópia de tokens OAuth.
- Cadência: ritmo restrito a `Curta`, `Padrão`, `Longa` antes da inferência. Antes, um ritmo não suportado podia passar pela preparação e falhar somente ao interpretar a resposta.

Schemas públicos consultados: [SERP](https://apify.com/apify/google-search-scraper/input-schema), [CNPJ](https://apify.com/bigdavidson/brazil-cnpj-companies/input-schema). OpenAPI dos builds `G3YvRcwtJopIgVcSA` e `vtjaMYkiw3DKROihP` conferidos pela API pública Apify.

## Resultado do lead real

Lead `8435b6f3-9e82-4fba-aaa9-6c603b4c66a9`, lista `4ce6bf9e-abab-46df-b660-99b13b738f36`.

| Campo | Evidência/resultado |
| --- | --- |
| Empresa Maps | For Derm Clinic · Por Dra Andressa Faucz, Curitiba/PR |
| Site | https://fordermclinic.com.br/ — HTTP 200; também coletada `/contato/` |
| Telefone original Maps | +55 41 3013-6190 |
| Outro telefone publicado | 41 99197-9796; disponibilidade como WhatsApp não testada |
| E-mail publicado | contato@fordermclinic.com.br |
| Verificação do e-mail | Formato válido; DNS/MX inconclusivo; caixa postal não verificada |
| CNPJ do site e lookup | 37.297.479/0001-80 |
| Razão social | FDC SERVICOS E COMERCIO DE ESTETICA LTDA |
| Situação na fonte cadastral | ATIVA |
| CNAE retornado no dataset | 9602502 — Atividades de estética e outros serviços de cuidados com a beleza |
| Fonte do Actor CNPJ | minhareceita.org, indicada pelo próprio resultado |

O CNAE/situação foram conferidos no dataset real. Ainda não são campos editáveis estruturados do Lead. O piloto cadastral foi **lookup por CNPJ publicado no site**, não prova nacional de cobertura nem pesquisa real adicional por CNAE. E-mail veio do site; o Actor cadastral não forneceu esse contato.

## Jobs, custos e aplicação

| Etapa | Job | Run remoto | Estado | `usageTotalUsd` |
| --- | --- | --- | --- | --- |
| Maps, primeiro teste | `d044ae6a-0080-41cd-a076-4d65e5e6692f` | `O00X2abH1FP67OGA9` | completed, 1 inserido | 0.0042 |
| Enriquecimento, 1 lead existente | `8fa0ebfd-cb8c-47b4-871b-27541ed40b71` | `pbabZyKa5Ywfv4x9G` | completed, propostas para revisão | 0.008 |
| Descoberta Web, 1 resultado | `6def3a77-2c69-42a8-805e-5673f0dac073` | `CVuVmPuyO45hkGzP9` | completed, 1 inserido | 0.00455 |

Total dos três runs conferidos: **US$ 0,01675**. Teto configurado de US$ 0,50/run PPE. Armazenamento/uso posterior podem ser contabilizados separadamente. O ledger interno preserva custo monetário desconhecido e conta unidades, em vez de inventar valores financeiros.

Enriquecimento executou registry, website, deep, email, phone e validateEmail. Website foi corretamente pulado porque já existia. Extração e lookup produziram propostas pendentes, com evidências persistidas; o telefone original e demais campos salvos não foram sobrescritos automaticamente.

## IA real com ChatGPT no Codex

Roteamento do workspace: convencional somente, `codex-local`, modelo `gpt-6.1-sol`, JEV desativado. Diagnóstico confirmou ChatGPT autenticado sem expor identidade/token. Oferta **fictícia de QA**: automação de atendimento e agendamento para clínicas de estética, anunciada durante o teste; não é o posicionamento comercial aprovado do usuário.

- Job `d1986eeb-01d0-4243-a45f-68d2bb68ce4f`: qualificação e resumo reais, duas inferências. Concluído; sugeriu qualified com evidência do site e explicitou que não há prova de problemas no agendamento. Sugestão não aplicada.
- Primeira cadência `574c9628-dc57-4849-82d7-23233dc2068e`: o roteiro do smoke informou ritmo livre incompatível. A inferência foi descartada; chamada reconciliada como resultado indisponível/consumido, sem replay. Job failed preservado no histórico. Regressão de entrada corrigida para bloquear esse caso antes de consumir IA.
- Repetição anunciada com uma chamada adicional, ritmo Padrão: job `c68e30cc-5e52-4419-b30c-d42137e2987f`, completed, **três opções distintas com três etapas cada**, WhatsApp/e-mail e `stopOnReply:true`. Propostas usam o rótulo de oferta fictícia. Não foram criadas cadências de envio nem disparadas mensagens.
- Quatro inferências novas no total, três resultados úteis e uma descartada contabilizada; nenhuma chamada JEV/OpenAI/Gemini. A franquia ChatGPT não foi tratada como custo monetário zero.

Novos limites locais finitos: workspace candidatos 2 / apifyRuns 4 / codexCalls 4; global candidatos 2 / apifyRuns 5 / codexCalls 7. Demais provedores com quota zero. Os limites globais preservam espaço para reservas/consumo histórico, incluindo um run antigo não reconciliado em outro workspace. Scheduler permanece desligado; worker não contínuo.

## Verificação de software e acesso

- 131/131 testes unitários; 103/103 testes PostgreSQL, no banco `_test`.
- Typecheck e build de produção concluídos; 54/54 rotas no smoke sem sessão.
- Preview reiniciado em http://127.0.0.1:3210 para carregar código/ambiente novos. Login QA e quatro endpoints autenticados (capabilities, AI policy, resultados do enriquecimento, proposta de cadência) responderam 200. Capabilities: Maps/Web/CNPJ disponíveis; Apollo indisponível por credencial ausente.
- Revisão independente encontrou dois casos de identidade/coleta e dois limites de escopo dos scripts; todos corrigidos e revisados novamente, sem pendências importantes.
- Scripts de aceite exigem modo live, confirmação de uso e workspace em allowlist; não são executados pela suíte padrão. `smoke-lead-enrichment.ts` pode retomar o mesmo job, recusa outros jobs ativos antes de cada tick e não permite módulos IA no resume. `smoke-lead-ai.ts --cadence-only` exige a rota Codex convencional sem JEV.

Para revisar: selecionar o workspace QA acima, abrir `/executions/8fa0ebfd-cb8c-47b4-871b-27541ed40b71` e `/cadences/new/ai?job=c68e30cc-5e52-4419-b30c-d42137e2987f`. Aplicação de qualificação/enriquecimento e criação da cadência continuam ações humanas posteriores.

Não valida entregabilidade de e-mail, existência de conta WhatsApp, envio, qualidade em escala, busca nacional por CNAE, execução Apollo, browser/JavaScript ou crawling integral. Nenhum desses resultados é inferido do sucesso deste único lead.
