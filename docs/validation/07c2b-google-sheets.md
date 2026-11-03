# 07C.2b — Google Sheets do cliente

Data: 03/11/2026. Estado: concluído local/controlado após revisão independente ([revisão](07c2b-google-sheets-review.md)). [Plano do pacote](../superpowers/plans/2026-11-03-prometeus-cadence-07c2b-google-sheets.md). Segundo dos três pacotes do 07C.2; o 07C.2c (agenda) segue planejado. Não é aceite de produção pública.

## Contrato entregue

- **Página Google Sheets** (`/settings/apps/google-sheets`):
  - **Desconectado:** o painel da referência (EV-258), com "Conectar conta Google" ativo.
  - **Escolher planilha:** nome da planilha, nome da aba, colunas (campos declarados do lead) e gatilhos (lead gerado, qualificado, respondeu). O app cria a planilha na conta do cliente.
  - **Conectado:** "Planilha **nome** · abrir no Google", como no componente retido da referência. Mostra aba, gatilhos, colunas, última exportação e fila.
    - Ações: "Pausar"/"Retomar", "Nova planilha" e "Desconectar", com confirmação.
  - **Atenção:** um aviso com a ação de recuperação:
    - cabeçalho alterado: "Restaurar cabeçalho";
    - planilha apagada: "Criar planilha nova";
    - acesso recusado: "Reconectar conta Google".
  - Somente proprietário ou administrador age; os demais veem o estado.
  - O resumo de Apps mostra "Planilha nome · abrir no Google" e "Configurar", como a referência.
- **OAuth:** PKCE S256 e só o escopo `drive.file`, então o app alcança apenas as planilhas que ele mesmo cria.
  - O `state` vale 10 minutos, é de uso único e fica preso ao usuário, à sessão, ao workspace e ao provedor.
  - Escopo negado, `state` alheio, vencido ou usado: nenhuma conexão.
  - Os tokens ficam cifrados e nunca voltam ao navegador.
- **Exportação:** uma linha por lead, identificada pela coluna A "ID Cadence".
  - Um evento novo atualiza a mesma linha; uma repetição depois de resposta perdida não duplica.
  - Os valores são RAW, então nada vira fórmula. Só as colunas mapeadas são escritas.
  - Roda no lane `sheets`, separado dos webhooks.
- **Falhas:**
  - cabeçalho alterado, planilha apagada, acesso perdido ou renovação recusada seguram a fila até a ação de recuperação;
  - um 401 isolado tenta uma renovação antes;
  - 429, 5xx, rede e respostas ilegíveis voltam com backoff por até 24 h.
- **Revogação:** desconectar apaga tokens e fila. Pausar, reconfigurar ou reconectar durante uma exportação descarta o resultado atrasado.
- **Fora deste pacote:**
  - escolher uma planilha já existente (exigiria o Google Picker);
  - copiar leads antigos;
  - revogar a permissão do lado do Google. A interface aponta myaccount.google.com/permissions.

## Validação executada

- **Unitários:** 3/3 no arquivo do 07C.2 (linha, cabeçalho, esquema); 385/385 na suíte completa.
- **Integração focada:** 8/8.
  - `state` de outro usuário, sessão ou workspace: 403; usado ou vencido: 409; escopo negado: 422; 0 conexões, e nenhum token em listagens ou no banco;
  - PKCE e `redirect_uri` conferidos na troca do código;
  - linha por lead, mesma linha em eventos seguintes e nenhuma duplicata depois de resposta perdida;
  - cabeçalho alterado segura a fila, e "Restaurar" retoma;
  - renovação recusada pede reconexão, que não pode ser limpa com "Tentar de novo"; a reconexão retoma;
  - pausar ou desconectar durante a exportação descarta o resultado; planilha apagada pede uma nova;
  - contrato HTTP, só proprietário ou administrador, e 503 sem cliente OAuth;
  - revisão: 401 isolado com renovação, cota e API desativada sem atenção, `again` com janela nova, lead apagado cancelado, respostas por e-mail e WhatsApp, reconexão no meio da exportação.
- **Suíte completa de integração:** 521/521. Build e tipos exit 0, `git diff --check` limpo.
- **RED:**
  - sem o gatilho ampliado da 098, 3 testes de exportação falharam;
  - sem as correções da revisão, os 3 testes da revisão falharam.

## QA no navegador

Conta descartável `[RE] QA Sheets`, em 1920×855, comparada com EV-258:
- **Desconectado:**
  - painel em x 684 e largura 848, iguais à referência;
  - y 223 contra 222;
  - altura 325 contra 314, cerca de 11 px a mais (bloco de texto e botão);
  - botão "Conectar conta Google" com 251 px contra 246.
- **Sem cliente OAuth local:** o clique mostrou "O Google Sheets ainda não está configurado neste ambiente." e não houve chamada ao Google.
- **Escolher planilha** (fixture local com segredo vazio):
  - o envio mostrou "O acesso guardado não pôde ser lido. Reconecte a conta Google.";
  - não houve chamada ao Google, e o rascunho foi mantido.
- **Conectado em atenção:** "Restaurar cabeçalho" e "Pausar". Pausar trocou o botão para "Retomar" e anunciou a pausa.
- **Resumo de Apps:** "Planilha [RE] Leads QA · abrir no Google" e "Configurar".
- **390 px:** sem overflow.
- **Capturas:** [escolher planilha](evidence/07c2b-google-sheets/local-sheets-setup.jpg) e [atenção](evidence/07c2b-google-sheets/local-sheets-attention.jpg).
- **Não exercido:** o consentimento real do Google e a escrita numa planilha real. Não há cliente OAuth nem conta Google de teste autorizados; esses caminhos estão cobertos pelos testes, com o Google simulado.

## QA, runtime e custos

- **L-034 removed:** conta, workspace e pedido de workspace removidos por IDs exatos, sem resíduo; 0 conexões Google Sheets e 0 itens na fila.
- **Migrações:** 098/098a aplicadas localmente.
- **Runtime:** novo lane `sheets`; runtime reiniciado.
- **Custo externo:** zero, sem nenhuma chamada ao Google.
- **Entrega:** sem merge, push ou deploy.

## Limites

- **Operação:** exige `GOOGLE_SHEETS_CLIENT_ID`, `GOOGLE_SHEETS_CLIENT_SECRET` e `GOOGLE_SHEETS_REDIRECT_URI`, com o retorno em `/api/integration-oauth/google-sheets/callback`.
- **Verificação do Google:** o escopo `drive.file` não é restrito, mas o app OAuth precisa passar por ela antes do uso público.
- **Cota:** a coluna A inteira é lida a cada exportação, sem lote. A cota do projeto Google é compartilhada entre clientes; carga e lote ficam para o 08B.
- **Ordem das linhas:** reordenar linhas durante uma exportação pode fazer a escrita cair na linha de outro lead.
