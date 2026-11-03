# Revisão final — 07C.2a

03/11/2026. Revisão independente feita por um subagente somente leitura, em contexto novo, sobre os commits 8cde6c2 e 8bfba7e. Sem Critical. Foram confirmados:
- a referência fica presa ao workspace, ao usuário e ao app; uma exceção desfaz tudo e deixa 0 conexões;
- a AAD inclui workspace e conexão, então o texto cifrado não abre em outro workspace;
- `connector_secret` fica restrito ao `app.workspace_id` do lease;
- a chave não aparece em resposta nem em erro.

Os quatro Important e os menores baratos foram corrigidos numa passagem RED→GREEN (migração 097a e commit 991716f), sem segunda revisão.

| Achado | Correção | Regressão |
|---|---|---|
| Automações Apollo ignoravam a conexão e usavam a chave central | O rascunho e o hash de limites passam a incluir a conexão e a origem da credencial; o dispatch as copia para o checkpoint | Automação agendada busca com a chave da conexão |
| A chave central era um fallback silencioso para todo workspace | Opt-in por `APOLLO_CENTRAL_WORKSPACE_IDS`; o checkpoint marca `central` ou `connection`, e o worker recusa a central sem essa marca | Workspace fora da lista fica bloqueado |
| Qualquer erro no worker virava `CONNECTION_REVOKED` | Só `CONNECTION_CHANGED` vira revogada; uma falha ao decifrar ganha `CONNECTION_KEY_UNREADABLE`; o resto é relançado | Chave ilegível não é reportada como revogada |
| `APOLLO_MAX_PAGES=0` era trocado por 5 com chave própria | Valor explícito, inclusive 0, sempre prevalece | Workspace conectado com 0 fica bloqueado |

Menores corrigidos:
- **Lock:** a trava do conector é tomada antes de ler a revisão que sela a chave.
- **Linha `attention`:** a troca de chave encontra conexões em qualquer estado não revogado.
- **`connector_secret`:** exige papel no contexto.
- **Referências:** as vencidas ou consumidas são apagadas ao guardar uma nova.
- **Interface:**
  - o campo usa o rótulo visível, e o botão de mostrar tem `aria-pressed`;
  - erros com `role="alert"`, e Enter envia;
  - aviso para colar a chave de novo depois de uma falha;
  - controles só para proprietário ou administrador.

## Menores adiados (owner 08A)

1. **Endpoint de saúde (incerto):** aceita qualquer chave válida. Avaliar uma sonda de busca mínima ou documentar o escopo exigido.
2. **Erro ao decifrar na conexão:** aparece como 503 genérico.
3. **Leitura dupla:** a página Apollo lê as conexões duas vezes.
4. **Foco:** não volta ao gatilho depois de desconectar.
