# Revisão final — 07A.2

03/11/2026. A revisão foi feita por um subagente independente, somente leitura e em contexto novo, sobre os commits 6ff5583 e 267fe9e. Não encontrou nada Critical.

Itens confirmados pela revisão:
- **Limites com várias campanhas na mesma conta:** o teto de 12 por dia e o limite de cada campanha valem juntos. A trava por conta serializa os envios, `failed` não conta e uma linha por pessoa (chave primária e salto por `unique_violation`) impede convite duplo.
- **Dia e janela de envio:** o dia é o de Brasília (`America/Sao_Paulo`), a janela de dias úteis é aplicada e o `now` injetado é usado de forma consistente.
- **Desfechos do envio:** sem status ou com 5xx, o convite fica "incerto" e nunca é reenviado. 429 e 401/403 devolvem a pessoa à fila e seguram a conta.
- **Reteste antes do envio:** relê a trava, a campanha, a conta, a época e a versão de capacidade, e desfaz a reserva se algo mudou.
- **Aceite:** trava a linha. A chave primária do evento garante um lead e um evento. O enriquecimento usa só o `contact_info` do fornecedor.
- **Permissões:**
  - ativar e agir na campanha exige owner/admin no SQL;
  - ids de outro workspace dão 404;
  - as funções do worker pertencem só ao `cadence_worker`;
  - as permissões por coluna escondem `external_id`, `profile_url`, `op_token` e `account_id`;
  - RLS forçada em todas as tabelas novas;
  - nenhum id do fornecedor chega ao navegador.
- **Cópia da trava de cobrança:** fiel à definição anterior mais recente (092). O revisor conferiu as migrações 070, 080, 084 e 092.

Os seis Important e os menores baratos foram corrigidos numa passagem RED→GREEN, na migração 102a (commit a0a0237). Antes da correção falhavam 1 teste unitário e 4 de integração.

| Achado | Correção | Regressão |
|---|---|---|
| O livro de convites, a trava e o teto do dia eram chaveados pela linha da conexão. Desconectar e conectar de novo zerava o histórico, reconvidava pessoas e dobrava o teto do dia. As campanhas antigas ficavam "ativas" para sempre | O livro passa a ser do membro LinkedIn (`member_id`), e a trava e a contagem por dia também. Revogar a conta encerra as campanhas dela (`completed`, com o motivo) | Revogar, reconectar o mesmo membro e criar uma campanha nova: a mesma pessoa não é convidada de novo, e a campanha antiga aparece concluída |
| A leitura de aceites vai até 300 relações. Na expiração, um 404 na retirada (convite já aceito) virava "não aceite" e caía na lista errada | Quando o convite sumiu (ou nunca foi confirmado), o worker consulta o perfil. Se for 1º grau, registra o aceite | Aceite fora das relações lidas: fica `accepted`, com lead na lista de aceites e nenhum na de não aceites |
| A reserva de convite podia travar dois workers em ordem diferente | Contas em ordem fixa e `pg_try_advisory_xact_lock`: uma conta ocupada fica para a próxima rodada | Coberto pela ordem e pela trava sem espera. A concorrência real não foi reproduzida em teste |
| O aquecimento era aceito quando a plataforma liberava visita e curtida, mas o worker não aquece | O aquecimento sempre bloqueia a ativação até existir um executor | Teste unitário |
| Filtro substituído sem aviso (o primeiro setor parecido) e grau ignorado no modo post | Só serve o termo idêntico (ignorando acento e caixa); um parecido dá 422 com os termos do LinkedIn. A coleta respeita os graus escolhidos e descarta grau desconhecido e autores que são empresas | "Varejo" parecido dá 422 sem chamar a busca. No post com 2º grau ficam só os de 2º grau |
| Uma queda entre a reserva e o resultado deixava a pessoa em "enviando" para sempre | Depois de 5 min, a pessoa vira "incerto", com evento, e nunca é reenviada | Linha presa em "enviando": vira incerto e nada é enviado |

Menores corrigidos:
- **Vaga de envio:** a vaga de 20 min volta quando nada é enviado (nota sem dado, reserva desfeita, 429).
- **`{setor}`:** vem do setor do perfil, quando a busca devolve. Sem esse dado, a pessoa é pulada.
- **Incertos:** expiram após o prazo da campanha e param de manter a conta em consulta.
- **Exceção de cobrança:** só vale para o `cadence_worker` gravando na lista de aceites ou de não aceites da própria campanha.
- **UI:**
  - a ajuda de cargos agora diz que é uma busca única com qualquer um dos cargos;
  - "Outra prova" diz que fica guardada;
  - o rascunho tem id estável, então uma nova tentativa não cria outra campanha;
  - o texto do aquecimento diz que ele ainda não está disponível.

## Menores aceitos

1. **Relógio do worker:** o servidor do worker dita o dia, o espaçamento e a pausa. Hoje roda num só host. `nextBrasiliaMorning` usa UTC−3 fixo (o Brasil não tem horário de verão desde 2019).
2. **Sem limite de frequência ao explorar:** um operador pode gastar buscas da conta do dono. Cada exploração faz até 20 consultas de parâmetros e uma busca. A coleta também resolve os parâmetros de novo a cada página.
3. **404 no envio:** marca a pessoa como recusada de vez, mesmo quando o motivo é a conta ter sumido no fornecedor (essa conta já fica com erro na verificação do 07A.1).
4. **"Cancelar" no editor:** sai sem perguntar quando há um rascunho não salvo.
5. **Testes que faltam:** dois workers ao mesmo tempo de verdade; virada de dia às 23:59 e 00:00 de Brasília; abuso da exceção de cobrança (o lead do app não escolhe o id da pessoa, e a exceção exige o `cadence_worker`).
