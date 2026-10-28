# 06D.2 — Canais, inbox e comprovantes de entrega

Implementação de 27/10/2026 na branch `codex/channel-operation-06d2`, base `c655e71`. A base anterior foi integrada por fast-forward e enviada à `main`, com SHA remoto conferido. Este pacote não inicia a próxima família.

## Entrega e autoridade

- O histórico de WhatsApp e e-mail recebe evidência de aceitação, entrega e leitura a partir dos recibos persistidos. Estar conectado, abrir um QR ou marcar como lido no aplicativo não comprova entrega ao destinatário.
- Gmail/SMTP expõem aceitação; entrega, abertura, cliques e leitura continuam desconhecidos quando não suportados. Nenhum pixel ou estatística é inventado.
- O popup de teste acompanha o resultado e permite registrar uma observação do teste já autorizado e enfileirado. Essa operação não cria outra mensagem nem chama `sendOnce`. A revisão vincula workspace, administrador, conexão/revisão, mensagem e destinatário.
- Após eventual I/O de observação, o serviço confere novamente acesso, revisão e evidência durável. A resposta do adapter não pode fabricar um recibo. A migração086 acrescenta um diário de observação com RLS e índices; não acrescenta uma fila ou privilégio de dispatcher.
- Recebimento, agrupamento por referências/IDs, cancelamento de follow-up, opt-out e recuperação continuam nas autoridades existentes. A observação reconhece matrículas antigas e multicanal e somente considera retorno posterior à aceitação do teste.
- Comprovantes ficam recolhidos no histórico; conexão continua nos dois cartões e popups existentes. Rascunhos, atualização periódica, histórico citado e conciliação do resultado incerto são preservados.

## Provas automatizadas

`tests/06d2-channel-operation.test.ts`: ausência de recibo nunca transforma aceitação em entrega/leitura. RED por módulo ausente, depois GREEN.

`tests/integration/06d2-channel-operation.test.ts`: dois tenants, papéis reais, PostgreSQL efêmero, credenciais prontas sem entrega, recibos fora de ordem, SMTP aceito, ausência de pixel, idempotência sem envio, revogação de membro/revisão durante I/O, SQL direto, HTTP401/403/404/409/422, retorno na conversa e interrupção do follow-up. HTTP observado RED404→GREEN422; matrícula antiga REDfalse→GREENtrue.

As suítes `mail-inbound`, `whatsapp-recovery`, `whatsapp-dispatch`, `openwa-recovery`, `mail-oauth` e `mail-connections` comprovam parada multicanal/opt-out, reserva incerta, reinício sem novo POST e recuperação/revogação existentes. Não foi reimplementada essa autoridade para satisfazer o teste.

Gates anteriores à revisão final: **342/342 unitários, 378/378 integrações**, build de produção, TypeScript e `git diff --check` aprovados. A suíte focada do novo pacote tem8 casos de integração. O resultado pós-revisão e o fechamento de QA serão registrados em `evidence/06d2-channel-operation/verification.json`.

## Visual, limites e continuidade

Comparação apoiada no acervo RES existente, especialmente EV225 e EV264. A conta da referência não oferece os estados conectados/pagos; eles continuam **não observados**, conforme decisão do operador. Capturas locais distinguem telas vazias reais de respostas controladas exclusivamente no navegador. Os testes de banco/serviço não usam essas respostas visuais como prova de persistência ou envio.

Não houve mensagem externa, chamada paga, novo canal operacional ou alteração de credencial real. O piloto de ida/volta em contas próprias, validade dos tokens, domínio HTTPS público e confirmação de entrega pelos provedores continuam como gates explícitos de homologação/08B. Anexos fora de e-mail continuam sem capacidade anunciada; o contrato não adapta silenciosamente o conteúdo congelado. Não há aceite de paridade integral nem de produção pública.

Próximo pacote após o aceite local/controlado: **06B.5 — jornada integrada de prospecção e cadência**. O gate de fornecedores reais/qualidade permanece em06IA-H; produção, carga, observabilidade e recuperação pública permanecem em08B.

## Aceite pós-revisão —28/10/2026

**342/342 unitários,383/383 integrações,13/13 focadas**, build/tipos/diffcheck e checker RES aprovados.36 capturas, três após correção do e-mail com domínio maiúsculo, sem overflow/erro de página. Sessão revogada/expirada/workspace trocado e sessão de outro usuário negam publicação após I/O; a identidade do local-part de e-mail permanece preservada. [Revisão e menor adiado](06d2-channel-operation-review.md), [verificação](evidence/06d2-channel-operation/verification.json), [fechamento QA](evidence/06d2-channel-operation/closure-postreview.json). Próprio navegador fechado; sessão QA revogada; nenhum dado/canal/mensagem operacional criado. Runtime200/seis lanes saudáveis. Novo código permanece na branch de trabalho; a main remota contém a basec655e71 já enviada antes do pacote.
