# 07C.2b — Google Sheets do cliente

Data: 03/11/2026. Segundo pacote do [plano 07C.2](2026-10-27-prometeus-cadence-07c2-customer-connectors.md), depois do [07C.2a](2026-11-02-prometeus-cadence-07c2a-connectors.md).

A referência mostra o estado desconectado da página Google Sheets (EV-258). O componente retido do resumo de Apps mostra o estado conectado: "Planilha **nome** · abrir no Google" e o botão "Configurar". Os passos de escolha, mapeamento e gatilhos não foram observados, então seguem o texto da referência ("escolher a planilha, mapear campos e configurar gatilhos"), no padrão visual da página.

## Contrato

- **Autorização:** OAuth Google com PKCE, só com o escopo `drive.file`. O app só alcança as planilhas que ele mesmo cria, nunca o resto do Drive.
  - O `state` vale 10 minutos, é de uso único e fica preso ao usuário, à sessão, ao workspace e ao provedor.
  - O retorno nunca devolve tokens ao navegador. Os tokens ficam cifrados na conexão (AAD de workspace, conexão e revisão).
  - Escopo negado, `state` de outro usuário ou sessão, vencido ou já usado: nenhuma conexão.
  - Só proprietário ou administrador conecta.
- **Configurar:** escolhe o nome da planilha, o nome da aba, as colunas (só campos declarados do lead) e os gatilhos (`lead.created`, `lead.qualified`, `lead.connected`).
  - O app cria a planilha na conta do cliente, com o cabeçalho.
  - A coluna A, "ID Cadence", é técnica e fica sempre presente.
  - Trocar colunas exige uma planilha nova, para não desalinhar linhas antigas.
- **Exportação:** uma fila por lead e por conexão, alimentada na mesma transação dos eventos de integração.
  - O worker lê a coluna A. Se acha o lead, atualiza só as colunas mapeadas daquela linha; senão, acrescenta uma linha. Uma repetição não duplica a linha.
  - Os valores vão como `RAW`, então nada vira fórmula.
- **Falhas reparáveis**, que deixam a conexão em atenção e seguram a fila:
  - cabeçalho mudado: "Restaurar cabeçalho";
  - planilha ou aba apagada: "Criar planilha nova";
  - acesso revogado ou refresh negado: "Reconectar";
  - 429, 5xx e rede: nova tentativa com backoff, até 24 h.
- **Revogação:**
  - desconectar apaga os tokens e a fila;
  - uma exportação em andamento cujo resultado chega depois é descartada;
  - pausar cancela o que está na fila.

## Persistência

Migração 098:
- `integration_connection` aceita `google-sheets` e o estado `setup`, e ganha `config`, `config_revision`, `active`, `attention` e `last_success_at`;
- `connector_oauth_attempt`;
- `sheet_export`, a fila por lead;
- funções `SECURITY DEFINER` para começar e consumir o OAuth, salvar a conexão, configurar, agir, enfileirar e reivindicar, e para os tokens e o término no worker.

## Testes

- **Unitário:** linha a partir do lead e das colunas, valores sem fórmula, esquema de configuração.
- **Integração:**
  - `state` de outro usuário, sessão ou workspace, vencido ou usado, e escopo negado: 0 conexões;
  - exportação cria uma linha e a repetição atualiza a mesma linha;
  - cabeçalho mudado vira atenção e "Restaurar" volta a exportar;
  - refresh negado vira "Reconectar";
  - revogar durante a exportação descarta o resultado;
  - pausar cancela a fila;
  - contrato HTTP sem tokens;
  - somente proprietário ou administrador.
