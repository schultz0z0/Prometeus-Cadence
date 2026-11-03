# Revisão final — 07C.2c

03/11/2026. Revisão independente feita por um subagente somente leitura, em contexto novo, sobre os commits desde cd3ee90. Sem Critical. Foram confirmados:
- **Funções SECURITY DEFINER:** todas fixam `search_path=pg_catalog`, filtram pelo workspace e tiram o papel de `lock_membership`.
- **Papéis:** configurar exige proprietário ou administrador. O operador lê, reserva e cancela.
- **Grants e tokens:**
  - os grants por coluna deixam de fora `request_id` e `created_by`;
  - os tokens não aparecem em respostas nem listagens.
- **`slotId`:** cifrado com AES-GCM e AAD do workspace (`slot`, sem colisão com ids de conexão). Fica preso à revisão da conexão, à revisão da configuração e ao vencimento. Não serve em outro workspace e não pode ser forjado.
- **Refatoração do Sheets:** sem mudança de comportamento. O provedor da AAD, os códigos `SHEETS_*`, as mensagens, a página de retorno, a checagem de escopo e a classificação de nova tentativa do worker são os mesmos.

Os três Important e os menores baratos foram corrigidos numa passagem RED→GREEN (migração 099a e commit b65369c), sem segunda revisão. Os três testes da revisão falharam sem as correções e passaram com elas.

| Achado | Correção | Regressão |
|---|---|---|
| Uma repetição podia marcar como `failed` uma reserva já criada, que vê o próprio evento como ocupado, e deixar o evento no Google sem cancelamento | A repetição de uma reserva incerta a assume (`uncertain`→`prepared`) antes de chamar o Google. A repetição durante a primeira tentativa recebe 409 `RESERVATION_PENDING`. Ocupado numa repetição consulta o evento de novo antes de chamar de conflito | A repetição durante a criação espera, e a consulta atrasada termina como reservada |
| Um cancelamento concorrente com uma repetição deixava um evento órfão | O cancelamento recusa reservas `prepared`, e a reserva assumida fica `prepared`. As transições de estado só andam para a frente | A mesma regressão da linha anterior; o cancelamento duplicado segue com 1 DELETE |
| Reconectar não limpava "agenda não encontrada", embora o aviso mandasse reconectar | A reconexão da agenda limpa qualquer atenção | A reconexão traz os horários de volta |

Menores corrigidos:
- **Horário pulado pelo horário de verão:** vai para o instante seguinte; um horário repetido usa o primeiro. Há teste no dia da mudança em Nova York.
- **Horários sobrepostos de durações diferentes:** são recusados com uma trava por conexão e uma checagem de sobreposição, além do índice por início.
- **Lead apagado:** o lead é conferido depois da checagem de repetição, então um lead apagado não esconde a reserva guardada.
- **Erro original do Google:** não é mais escondido quando o registro local falha.
- **Token de acesso:** um teste confirma que ele também não aparece na listagem.

## Menores adiados (owner 08A/08B)

1. **Bloqueio sem confirmação:** depois de 10 minutos, o horário é liberado sem consultar o Google. Se o evento existe mas não aparece como ocupado, a reserva fica `failed` e não pode ser cancelada pelo app.
2. **Cancelamentos ou repetições simultâneos:** o segundo recebe 409 `RESERVATION_CHANGED`, embora o efeito tenha acontecido.
3. **Mesma conta Google em dois workspaces:** só a releitura da disponibilidade os separa.
4. **Cancelamento por operador:** um operador cancela qualquer reserva do workspace. Decidir no 07B.3.
5. **Testes ausentes:**
   - liberação do bloqueio vencido;
   - reserva e cancelamento por operador;
   - cancelamento pelo HTTP com sucesso.
