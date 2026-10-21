# Conexões a preparar antes do piloto de fontes

> Atualização posterior: contratos Web/CNPJ corrigidos, Maps/Web/CNPJ e IA Codex testados no piloto de um lead. Ver [aceite real](../validation/2026-10-21-prospecting-full-live.md). O texto abaixo registra a preparação anterior; seus bloqueios de contrato/binário já foram resolvidos no escopo desse aceite.

Data: 21/10/2026. Checklist de pesquisa; não altera ambiente ou habilita gastos. Estudo: `2026-10-21-cnpj-web-sourcing-study.md`.

## Apify: uma credencial, Actors diferentes

Obter o token na área API & Integrations da conta Apify. O mesmo token autentica os Actors autorizados; não é necessário obter uma chave diferente para cada Actor. Guardar somente no servidor, no campo `APIFY_TOKEN` de `.env.local`; não colar em conversa/Git/frontend.

Perfis que já têm variáveis no aplicativo:

| Variável | Destino proposto |
| --- | --- |
| `APIFY_MAPS_ACTOR` | `compass/crawler-google-places` |
| `APIFY_MAPS_BUILD` | Build fixado e validado; candidato consultado `0.14.775` |
| `APIFY_WEB_ACTOR` | `apify/google-search-scraper` (somente descoberta/SERP) |
| `APIFY_WEB_BUILD` | Build fixado e validado; candidato consultado `0.0.468` |
| `APIFY_CNPJ_ACTOR` | Manter `bigdavidson/brazil-cnpj-companies` por enquanto |
| `APIFY_CNPJ_BUILD` | Build fixado e validado; candidato consultado `0.1.2` |
| `APIFY_MAX_CHARGE_USD` | Teto deliberado para runs PPE, não garantia universal para PPU |
| `APIFY_MAPS_PPE` / `APIFY_WEB_PPE` | Ativar somente com o contrato PPE correspondente verificado |

Não copiar valores de exemplo e anunciar “conectado”. Precisamos corrigir paginação/idioma do Web e os arrays UF/cidade, limite `maxRecords` e tratamento do output CNPJ, validando input/output contra o build escolhido. O crawler de conteúdo `apify/website-content-crawler` ainda não tem um perfil independente no aplicativo; não colocar seu Actor no lugar da variável WEB e esperar compatibilidade.

Endpoints comuns (Bearer no cabeçalho, nunca token na URL de logs):

- `POST https://api.apify.com/v2/acts/compass~crawler-google-places/runs`
- `POST https://api.apify.com/v2/acts/apify~google-search-scraper/runs`
- `POST https://api.apify.com/v2/acts/bigdavidson~brazil-cnpj-companies/runs`
- `GET https://api.apify.com/v2/actor-runs/RUN_ID`
- `GET https://api.apify.com/v2/datasets/DATASET_ID/items`
- `POST https://api.apify.com/v2/actor-runs/RUN_ID/abort`

Criar um run pode consumir saldo. Primeiro revisar build/schema e autenticação somente por endpoints de leitura. O worker deve preservar run/dataset/checkpoints e não repetir um POST com resposta incerta.

Maps: começar sem reviews, imagens, contatos de pessoas, verificação de e-mail ou filtros pagos extras. Acrescentar só o campo necessário após conferir preço. Nome/telefone/endereço/site disponíveis não equivalem a leads todos qualificados ou a números WhatsApp válidos.

## CNPJ/CNAE

Decisão atual do usuário: manter a estratégia Apify enquanto a substituição integral não estiver comprovada. Preparar o Actor acima; nenhuma troca foi aplicada. O Actor informa remover e-mail da fonte e não fornecer todos os contatos de EI/MEI, portanto planejar enriquecimento separado, não prometer esses campos.

No candidato de catálogo local, não há chave paga para baixar os arquivos públicos. Precisamos de licença esclarecida do pipeline escolhido, banco/volume próprios, papel importador e papel leitor, competência/staging/publicação e orçamento de disco. A credencial do catálogo será distinta do banco transacional. Nenhuma nova variável CNPJ local foi implementada ainda. Não baixar tudo automaticamente ao salvar configurações.

## Sites

Coletor HTTP já existe, mas só tenta três caminhos em modo deep. Novo crawler deve descobrir links/sitemap, registrar cobertura e usar navegador quando necessário.

- Coletor local: não exige chave de scraping, mas exige worker/browser isolado e capacidade de execução; ainda não instalado.
- Alternativa Apify: `apify/website-content-crawler`, build consultado `0.3.101` (`version-0`); ainda não integrado. Usar limites explícitos; defaults públicos são amplos.
- Firecrawl é alternativa de arquitetura, não conta obrigatória. Não contratar/conectar antes de escolher a opção e medir o piloto.

## Apollo

Credencial servidor `APOLLO_API_KEY`, `APOLLO_MAX_PAGES` e cotas `apolloPages`/candidatos. Conector atual é Organizations Search (empresas), não a busca/revelação de e-mails de pessoas. Confirmar elegibilidade da API na própria conta antes de prometer que a franquia gratuita inclui esse endpoint. Não há novo teste real nesta investigação.

## IA

JEV: `OPENROUTER_API_KEY`, modelo `typesafe/jev-1.13`, limite `jevCalls`; sempre com convencional válida. Sem JEV, a convencional continua responsável por toda a IA.

Codex: corrigir caminho local do executável, validar a versão nova, manter sessão ChatGPT no CLI, workspace explicitamente liberado e limite escolhido. Configuração atual apontava para binário ausente; a versão instalada é `0.163.0-alpha.11`, diferente da versão aceita pelo conector. As três inferências do aceite anterior estão consumidas; não houve nova inferência. Não copiar tokens OAuth nem usá-los como chave de API.

OpenAI/Gemini: alternativas já implementadas, exigem chave/modelo e limites próprios. Não são obrigatórias se Codex for a convencional escolhida para testes locais.

Após mudanças de ambiente, reiniciar servidor e worker. Verificar política do workspace em `/settings/ai`. Teste de conexão com inferência é uma execução confirmada que consome limite; diagnóstico de binário/autenticação é separado.

## Aceite gradual

1. Preparar configurações e testar contratos sem executar provedores.
2. Restaurar a convencional e validar uma geração real com escopo/limite escolhido.
3. CNPJ Apify: pequeno piloto com CNAE/UF/cidade explícitos, empresas/avisos/erros separados e conferência de cobertura. Catálogo local somente depois de resolver licença e decidir pela prova nacional isolada.
4. Maps/SERP: piloto pequeno, registrando bruto/aceito/deduplicado, custo e latência.
5. Crawler: mesmos sites e campos em todas as alternativas; medir páginas, conteúdo útil, bloqueios, segundos de browser, tráfego e custo.
6. Só então extrapolar para 5 mil leads/workspace/mês e definir o preço/quota do produto. Jobs e credenciais configurados não são evidência de capacidade/custo em produção.
