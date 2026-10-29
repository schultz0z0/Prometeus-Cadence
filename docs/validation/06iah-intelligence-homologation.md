# 06IA-H — Homologação das fontes e inteligência

Status: implementação local/controlada verificada; revisão independente pendente. O aceite empírico com fornecedores reais e a liberação pública não fazem parte deste resultado.

## Entrega

O administrador da plataforma pode conferir, revisar, executar e reler avaliações versionadas pela CLI. Clientes não recebem credenciais Apify/LLM nem uma nova tela administrativa. Trinta casos sintéticos rotulados cobrem identidade, site/ausência, QSA, gestor não sócio, homônimos, função histórica, contatos corporativos/pessoais, citação falsa, fonte ausente e instrução injetada. As variantes tradicional e híbrida usam as mesmas evidências e propostas autoradas, passando pelos validadores de produção; a híbrida exercita o parser estruturado JEV com transporte offline. Isso testa contratos e abstenção, **não executa inferência real nem mede acurácia de modelos/Actors**.

O avaliador compara cada fato e citação ao gabarito, em vez de confiar em contadores enviados pelo modelo. Conjunto incompleto/denominador vazio não é aprovado; os gates exigem zero fatos sem suporte/zero vazamentos, precisão de atribuição≥95% e abstenção integral nos casos sem suporte. Cobertura é informativa; um caso deliberadamente omite um contato que existe no gabarito, demonstrando perda de cobertura sem inventar resultado.

SQL088 restringe runs e receipts à administração central, com RLS por workspace, sessão/ator, revisão, fingerprint e lease. Não há escrita ampla do dispatcher. Retries da mesma solicitação não chamam novamente o adapter. Mudança de contexto, Actor/configuração de fonte, modelo ou instruções invalida o relatório. Revogação durante I/O preserva somente hash/custo técnico recebido, sem dados brutos nem publicação de resultado aprovado. Um run incompleto pode ser lido como pendência; não é retomado automaticamente.

As instruções internas do produto passam a `prometeus-skills-v2`, com tarefa `company_people` própria: encontrar sócio/gestor não exige inventar contato pessoal. A tarefa de contato entregável continua com seus requisitos. Não é uma skill instalada no Codex. O acervo O Setup não estava disponível nas ferramentas da sessão; nenhum novo plugin/MCP/Actor foi recomendado ou instalado.

## Operação administrativa

Executar a partir da raiz com Node e as dependências existentes:

```powershell
rtk proxy node --conditions=react-server --experimental-strip-types scripts/evaluate-research.ts --action=check --manifest=.runtime/evaluation-manifest.json
rtk proxy node --conditions=react-server --experimental-strip-types scripts/evaluate-research.ts --action=prepare --manifest=.runtime/evaluation-manifest.json --session=.runtime/evaluation-session.json
rtk proxy node --conditions=react-server --experimental-strip-types scripts/evaluate-research.ts --action=run --manifest=.runtime/evaluation-manifest.json --session=.runtime/evaluation-session.json --review=.runtime/evaluation-review.json
rtk proxy node --conditions=react-server --experimental-strip-types scripts/evaluate-research.ts --action=read --manifest=.runtime/evaluation-manifest.json --session=.runtime/evaluation-session.json --run-id=ID_DO_RUN
```

O manifesto contém `datasetFile` e `input:{requestId,datasetVersion,caseIds,mode,maxCostUsd}`; `requestId` é UUID novo por intenção, preservado no replay. Fixture aceita custo0 e usa o arquivo sintético versionado em `tests/fixtures/research-evaluation.json`. A sessão privada contém `{cookie,workspaceId}` de uma sessão autenticada do administrador da plataforma; owner comum não é suficiente. Salvar a saída de prepare em arquivo privado de revisão com `token`/`basisHash`, conferir antes de run. Não colocar cookies, tokens ou dados reais no Git/log compartilhado. A CLI herdada `evaluate-prospecting.mjs --research` delega ao mesmo fluxo.

`live-owned` exige opt-in `--live-owned=true`, orçamentoUSD positivo, arquivo `--outputs` com `{fingerprint,predictions}` e versões iguais à revisão. É **benchmark de saídas próprias previamente coletadas**, sem chamadas a fornecedores; todos os relatórios mantêm `empirical:false`. Não importa código executável. Custo desconhecido permanece `null`, interrompe o processamento e não vira zero. O serviço interno admite adapter controlado pelo servidor com teto por operação; não há adapter pago selecionado ou executado nesta entrega. Qualquer piloto real precisa de coleta/rotulagem, autorização, orçamento e reconciliação próprios. Um journal incerto bloqueia nova execução live nesse workspace até apuração administrativa; não editar SQL para forçar sucesso.

## Verificação e visual

350/350 unitários,415/415 integrações completas,13/13 focadas, build de produção e tipos pós-build aprovados antes da revisão. As integrações usam banco efêmero com papéis reais e incluem CLI autenticada, SQL direto, revogação durante I/O/cotação, custo ausente, contrato errado e replay. Nenhuma chamada paga ou envio externo.

Nove capturas reais de leitura em `/settings/ai`, `/settings/context`, `/leads/enrich`, nos viewports1920×855/390×844/320×844, sem overflow horizontal/pageerror. Cliente comum vê infraestrutura central, contexto privado e enriquecimento vazio/bloqueado, sem oferta administrativa nova. Tab/Escape/navegação/scroll conferidos sem salvar campos. A implementação não altera CSS/componentes de tela; preserva a composição existente. Referência histórica EV217/226/271: diferenças de contexto já registradas e estados pagos/conectados não observados continuam sem aceite100%; esta rodada não comprova loading/erro/sucesso não capturados ou todos os popups da referência.

QA dedicada preservada, workspace anterior restaurado, própria sessão revogada e navegador próprio fechado; zero contatos/canais/outbox/pilotos criados. Migração088 aplicada ao banco local, build atualizado e seis lanes saudáveis,localhost200. Nenhum push/merge/deploy.

[Verificação](evidence/06iah-intelligence-homologation/verification.json), [manifesto de capturas](evidence/06iah-intelligence-homologation/manifest.json), [resultado sintético](evidence/06iah-intelligence-homologation/fixture-report.json), [cleanup](evidence/06iah-intelligence-homologation/closure.json), [decisões](evidence/06iah-intelligence-homologation/execution-ledger.md).
