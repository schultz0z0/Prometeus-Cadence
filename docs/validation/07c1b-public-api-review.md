# Revisão final — 07C.1b

02/11/2026. Revisão independente feita por um subagente somente leitura, em contexto novo, sobre os commits desde d8988d2. Sem Critical. Foram confirmados:
- revogação, rebaixamento e remoção do criador valem na chamada seguinte, e a rotação nunca devolve o token antigo;
- o digest nunca chega ao app;
- o cookie não autentica;
- o token tem entropia de 256 bits;
- o contador de limite é atômico;
- o limite de chaves é serializado;
- as correções da 095a foram preservadas;
- não há leitura cruzada entre tenants com o principal sem sessão.

Quatro Important e os menores baratos foram corrigidos numa passagem RED→GREEN (migração 096a e commit 164f57a), sem segunda revisão.

| Achado | Correção | Regressão |
|---|---|---|
| Cursores pulavam linhas com commit atrasado (imports longos, `createdAt` do cliente) | Eventos só aparecem depois de 60 s de atraso de commit; os leads ficam documentados como foto, não feed | Evento fresco invisível; depois do atraso aparece e o polling segue do cursor |
| A última página não devolvia cursor para retomar | `nextCursor` sempre devolvido, mais `hasMore` | Cursor ocioso devolvido igual |
| Paginação sem índice (varredura e ordenação a cada página) | Índices `integration_event(workspace_id,occurred_at,id)` e `lead(workspace_id,createdAt,id)` | Revisão de código |
| Uma chave `events:read` esquecida ligava a gravação para sempre | Só contam chaves usadas ou criadas nos últimos 7 dias cujo criador ainda é proprietário ou administrador | Chave com 8 dias sem uso: 0 eventos |

Menores corrigidos:
- **Chave e papel na leitura:** são conferidos de novo na transação da leitura (fecha a janela entre resolver e ler).
- **Escopo ausente:** conta no limite de requisições (teste).
- **Ordem das checagens:** autenticação antes da validação (teste); `list` é recusado em `/events` (teste).
- **Campos do evento:** `listId` e `channel` expostos.
- **Desafio RFC 6750:** `Bearer` puro sem token e `error="invalid_token"` com token inválido.
- **Interface:**
  - o banner diferencia "Chave criada" de "Nova chave gerada";
  - o resultado é anunciado em região viva;
  - o limite de 10 é explicado;
  - o banner do segredo tem `role="group"`;
  - o diálogo avisa da retenção de 30 dias dos eventos.

## Menores adiados (owner 08A)

1. Janela fixa de um minuto (até 240 requisições na virada).
2. A falha de `listApiKeys` também derruba a listagem de webhooks no `GET /api/integrations`.
3. As funções `SECURITY DEFINER` dependem do dono ignorar `FORCE ROW LEVEL SECURITY`, como no 095.
