# 06E.2 — Duplicados, fusão, privacidade e ciclo dos dados

Data: 02/11/2026. Estado: concluído local/controlado após revisão independente ([revisão](06e2-data-lifecycle-review.md)). Não é aceite de paridade 100% nem de produção pública.

## Contrato entregue

- **Contatos duplicados (`/settings/dados`).** A busca varre a base inteira em uma consulta SQL. Agrupa só por chave forte normalizada (CNPJ, e-mail, telefone BR); nome+cidade e site ficam de fora, como na referência. Grupos com seleção, revisão com token (10 min) e fusão por grupo em transação própria: um grupo em conflito falha sozinho, sem fusão parcial.
- **Fusão.** O contato mais antigo fica (regra imposta no SQL, não só na UI) e recebe apenas campos vazios. Conversas, evidências, entregas de enriquecimento, itens de prospecção, atribuições de automação, pessoas aplicadas e resoluções passam para ele. O contato apagado é guardado inteiro em `merge_source` até o fim da janela de 7 dias. Nenhuma fusão consome quota.
- **Consentimento mais restritivo.** Um opt-out de qualquer contato do grupo é estendido ao e-mail do principal. Se for um telefone que o principal não compartilha e sem identidade criável, o grupo é recusado com explicação, em vez de perder o descadastro. Desfazer nunca remove supressões.
- **Desfazer (7 dias).** Só ocorre se o principal e todos os vínculos movidos estiverem exatamente como a fusão os deixou; caso contrário retorna 409, sem sobrescrever trabalho novo. Restaura o contato, os vínculos, as atribuições descartadas (linha completa), as pessoas aplicadas e as identidades de lista. Os campos copiados para o principal permanecem, como a referência anuncia. Repetições com o mesmo `requestId` são idempotentes.
- **Conflitos recusados.**
  - dois contatos na mesma publicação de cadência;
  - contato a apagar com matrícula ativa/bloqueada (os snapshots de publicação endereçam o lead original);
  - dois contatos com entrega de enriquecimento;
  - contato a apagar com investigação própria (a FK de `research_company_identity` impede mover o caso).
- **Privacidade (`/settings/privacy`).** Política de retenção do texto das mensagens, somente para o dono, com revisão otimista. Prazos da referência: enviadas 30 dias–5 anos, respostas 90 dias–5 anos. Ligar ou encurtar exige digitar APAGAR (UI e SQL). O worker do lane `notifications` apaga em lotes `channel_message.text` e o conteúdo do outbox terminal; a mensagem continua visível como "texto indisponível". O assunto do e-mail permanece, como na referência.
- **Exclusão de contato.** Grava um tombstone sem conteúdo (workspace, id, data, ator). Também:
  - apaga fatos e fontes de pesquisa e colisões de identidade do contato;
  - zera o conteúdo dos itens de prospecção;
  - limpa o cache de IA do workspace (uma vez por comando);
  - remove os snapshots de fusões feitas para dentro dele.

  As resoluções de enriquecimento ficam, porque outras entregas as referenciam.

## Validação executada

- **Domínio:** 4/4 testes unitários (chaves fortes, nome igual não agrupa, prazos e confirmação, limites dos inputs).
- **Integração focada:** 11/11.
  - varredura além da primeira página;
  - fusão com replay sem quota e desfazer bloqueado após edição;
  - consentimento;
  - grupo em conflito isolado e revisão vencida;
  - exclusão com purga isolada por tenant;
  - empresa enriquecida;
  - restauração completa no desfazer;
  - telefone descadastrado;
  - replay com grupos não revisados;
  - retenção por direção, dono, APAGAR e isolamento;
  - contrato HTTP 401/409/422 e desfazer idempotente.
- **Suítes completas:** 371/371 unitários, 477/477 integrações, build e tipos exit 0, `git diff --check` limpo.

QA real no navegador, com o banco operacional local e uma identidade descartável (L-028):
1. A busca mostrou 3 grupos e o par de mesmo nome+cidade+site não foi agrupado.
2. Fusão de 2 grupos após a revisão. No banco, o principal manteve o próprio e-mail e recebeu telefone/site vazios.
3. Desfazer restaurou o contato; o histórico mostra "desfeita".
4. Privacidade: ligar exigiu APAGAR, alongar salvou direto e encurtar abriu "Encurtar o prazo…". O estado persistiu após recarregar.
5. Em 390 e 320 px não houve overflow.

Medidas em [qa-geometry.json](evidence/06e2-data-lifecycle/qa-geometry.json).

## Visual e referência

Fontes: [EV-222](../reverse-engineering/visual-2026-10-25/evidence/EV-222-duplicates-ref.json)/EV-223, [EV-252](../reverse-engineering/visual-2026-10-25/evidence/EV-252-privacy-ref.json), textos de privacidade e deduplicação do reaudit de 24/10 e os componentes de cliente da referência em `artifacts/client`, para fluxos, diálogos e textos.

A 1920×855, os painéis têm x=532 e largura 1152 como a referência. Em Duplicados, as alturas 210/137 e o espaço de 24 px entre painéis batem. Em Privacidade, o painel começa em y=194, o switch fica em y≈310, o aviso em y=368 e o Salvar tem 32 px, como na referência.

Diferenças registradas:
- Os painéis de Duplicados começam 36 px abaixo do EV-222, enquanto Membros e Privacidade batem exatamente. A causa não foi isolada (provável estado da faixa de trial na captura).
- O aviso de Privacidade é 20 px mais baixo: os bullets foram adaptados, porque a referência cita LinkedIn, Chatwoot e o Agente SDR, que não existem no Prometeus, e um prazo de 30 dias de backup que o produto não comprovou.
- A cópia do switch diz "rotina automática" em vez de "uma vez por dia", porque o worker roda em lotes contínuos.
- Não há capturas arquivadas deste pacote: o painel do navegador estava oculto durante a QA, então a evidência é a geometria medida no DOM.

## Decisões de execução

1. **Prazos de retenção.** Seguem a referência (30/90 dias mínimos), não os 7/30/90/180/365 do desenho da área. A fidelidade ao CadenceFlow prevalece, e a referência é explícita nos mínimos.
2. **Autoridade em SQL `SECURITY DEFINER`** escopado por `app.workspace_id`, com o lock de workspace existente. Custo: lógica de fusão em plpgsql.
3. **Undo mantém os campos copiados** (texto da referência). Custo: não é o inverso exato do principal.
4. **Exportação e exclusão em lote pela tela de Privacidade não foram entregues.** A referência não as mostra. A exclusão segue pelo fluxo existente de Contatos, agora com tombstone e purga; a exportação privada continua pendente para 07C.1/08A. O pedido `DataRequest`/export do desenho não foi implementado e não é anunciado na UI.
5. **Migração 092a de seguimento.** A 092 já estava aplicada localmente com checksum, então as correções da revisão vieram numa migração nova.

## QA, runtime e custos

- **L-028 removed:** usuário, workspace `[RE] QA Dados`, 82 linhas de app, sessão e conta, removidos por IDs exatos. Nenhum dado do operador foi alterado. E-mails de cadastro só no capturador local.
- **Migrações:** 092/092a aplicadas localmente.
- **Runtime:** o contínuo foi reiniciado e o lane `notifications` (com a purga) está saudável.
- **Custo externo:** zero (sem envios, Actors ou LLM).
- **Entrega:** sem merge, push ou deploy.

## Fechamento

Revisão independente em 02/11: sem Critical; seis Important corrigidos e um item incerto tratado de forma conservadora, todos com RED→GREEN; menores registrados. Próximo: 06F — assistente, busca, onboarding e ajuda.
