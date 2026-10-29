# 06B.5 — Jornada integrada de prospecção e cadência

Data:28/10/2026. Status: implementação local/controlada em validação final e revisão independente. Não representa aceite de acurácia live, paridade integral com a referência ou produção pública.

## Comportamento entregue

O usuário informa um objetivo, localização e teto de empresas, revisa o consumo e confirma. A jornada associa busca Maps, investigação pública, identidade/pessoas e qualificação aos jobs existentes. Não existe outra fila ou processo de worker. O contexto aprovado e a configuração da fonte/IA ficam congelados na revisão; mudança durante I/O impede nova publicação de domínio. Resultados recebidos permanecem no journal autorizado e uma chamada incerta exige reconciliação.

Etapas são persistidas por workspace/jornada/fase/versão/lote, com FKs compostas, RLS forçada e leases. Pessoas usam lotes de até100, as demais etapas até500. O worker atual avança e recupera o intervalo entre concluir um filho e criar o próximo. Pausa preserva os resultados; retomada revisada não pula a etapa cancelada. Investigação parcial permite aproveitar resultados sem converter ausência em fato. No cenário controlado de100 empresas,70 concluídas permanecem e apenas30 pendentes são consultadas na retomada.

Propostas de cadência exigem outra revisão de custo. Confirmar a análise cria um job de planejamento e nenhum envio. A escolha/editagem revisada usa o serviço de planejamento atual, cria exatamente um rascunho com origem e associa o resultado à jornada. A geração sugere três etapas, mas a escolha aceita1–20 etapas. Canais desconectados podem ser planejados como no wizard existente; remetente, consentimento, janela, limites e conteúdo são revalidados na publicação separada06D.

## Superfícies e integração

- `/leads/generator`: entrada em popup “Prospecção completa”, sem trocar o formulário de fonte existente.
- `/automations/new/ai`: após criar lista/automações pausadas, atalho para a mesma jornada com destino preenchido; sem iniciar recorrência implicitamente.
- `/executions/[id]`: etapa atual, histórico ligado às demais fases, parcial/pausa/retomada, consumo, contatos e passagem revisada para sugestões.
- `/contacts`: destino real preservado; aplicação de fatos/pessoas/qualificação continua revisada nas superfícies existentes.
- `/cadences/new/ai?job=...`: escolha/edição das opções, rascunho e origem, com quantidade editável de etapas. `/cadences/new` continua como canvas manual.
- POST `/api/prospecting/journeys`: prepare/confirm. GET porid oujobId. POST `/:id/{cancel,resume,prepare-cadence,confirm-cadence}`; resume distingue prepare/confirm. JSON estrito, origem/sessão/workspace atual e autorização reais.

## Evidência e testes

Antes da revisão final:346/346 unitários,392/392 integrações completas e9/9 focadas. Build inicial e tipos passaram. A compilação final, revisão independente e cleanup são registrados abaixo quando efetivamente concluídos.

RED→GREEN: contrato de domínio ausente; serviço ausente; handler HTTP ausente; retomada que pulava pesquisa cancelada; repetição do cliente após resposta perdida com chave alterada por mutação controlada. A primeira suíte completa encontrou uma fixture com concorrência global1 ocupada por casos anteriores; a suíte própria usa o limite já suportado32 apenas no processo de teste. Reexecução completa392/392 verde. Nenhuma política operacional foi ampliada.

Casos de integração: repetição concorrente/lista/job/reserva únicos; despacho normal do worker; preservação70/retomada30; contexto alterado e revisão obsoleta; pausa de etapa na fila; isolamento/role/lease/SQL; revogação ou contexto durante coleta com0publicação; análise pura/um rascunho/0outbox; HTTP401/403/404/409/422 e idempotência. Fontes e propostas são fixtures, autoridade/banco/quota/transações são reais no catálogo efêmero `_test`.

48 capturas mascaradas iniciais em1920×855,390×844 e320×844. Popups de entrada, revisão bloqueada real da QA, revisão controlada, progresso, pausa, retomada, parcial, análise de cadência, vínculo, incerteza, falha e recuperação. Nenhum overflow horizontal/pageerror nos estados medidos. Voltar preservou o texto e Escape fechou o popup. [Manifesto](evidence/06b5-prospecting-journey/manifest.json) e [verificações](evidence/06b5-prospecting-journey/verification.json).

## Fidelidade, limitações e gates

Referência histórica L4:EV205/206 automação,EV211/212 cadência com IA,EV213/214 canvas eEV231/232 gerador. Tipografia, cores, painéis, campos e popup reaproveitam os componentes de referência existentes. A imagem histórica do gerador inclui outro estado/fonte e skeleton; não é prova de igualdade de todos os estados. A entrada e o painel agregado da jornada são composição do contrato próprio; os estados pagos/conectados originais continuam **não observados** conforme decisão do usuário. Não houve nova escrita, compra, trial ou autenticação na referência. Diferenças preexistentes de fonte/filtros/shell não receberam aceite100%.

Nenhum Actor, ferramenta ou dependência nova foi recomendado/instalado. Reuso dos perfis centrais Apify, LLM e JEV existentes; credenciais nunca são configuração do cliente. Produto não é escolhido implicitamente, pois o DTO aprovado desta jornada não contémproductId; contexto da empresa é congelado e o wizard de planejamento já permite escolha explícita de produto.

Os dados de UI controlados são respostas interceptadas no navegador, sem persistência, consumo ou chamadas externas; não comprovam cobertura de fontes nem entrega de mensagens. Homologação de inteligência/acurácia em06IA-H exige piloto próprio com teto/autorização; produção pública, carga e restore pertencem ao08B. Próximo pacote previsto:06IA-H, após este aceite efetivo.

## Operação, documentação e fechamento

Docker estava desligado no início; iniciado oculto. Migração087 aplicada no ambiente local autorizado e supervisor de seis lanes retomado. A QA usa identidade dedicada existente; snapshot anterior, workspace e sessão são restaurados/revogados no fechamento. Nenhum contato/canal/cadência/job operacional é criado por esta QA visual. O journal dos testes existe apenas no banco efêmero, removido pelo runner.

Branch de trabalho:`codex/prospecting-journey-06b5`, base85009f4. Sem push/merge/deploy implícito. [Ledger de execução](evidence/06b5-prospecting-journey/execution-ledger.md). Revisão e fechamento final pendentes nesta seção.

### Fechamento antes da revisão independente

Build final do código exato e tipos pós-build aprovados;346/346 unitários e392/392 integrações.57 capturas no manifesto, incluindo nove da edição com quatro etapas, texto preservado após16s de polling, revisão e confirmação controlada de um rascunho. REA capturou passivamente o popup local mascarado em390×844:ev_87eddcb94ae5da1a28ea826623f4afebff3e59911344f705eaf6f6e745192881. Não é uma observação nova do CadenceFlow. QA restaurada e sessão revogada, comprovadas emclosure.json; nenhum dado anterior alterado. Localhost200/seis lanes saudáveis. Revisão independente ainda não concluída.
