# Revisão final — 07C.2b

03/11/2026. Revisão independente feita por um subagente somente leitura, em contexto novo, sobre os commits desde 089abe5. Sem Critical. Foram confirmados:
- o `state` OAuth é guardado como hash, preso ao usuário, à sessão, ao workspace e ao provedor, vale 10 minutos, é de uso único, e o envelope é apagado;
- o PKCE usa S256;
- o retorno é validado e o `redirect_uri` fica fixado no envelope;
- os tokens ficam cifrados com AAD de workspace, conexão e revisão, e a revisão é consistente na primeira conexão e na reconexão;
- os tokens não aparecem em listagens, respostas ou erros;
- toda mutação passa por `connector_actor`;
- RLS com FORCE nas duas tabelas novas, grants por coluna e funções do worker só para `cadence_worker`;
- o `emit_integration_event` substituído é idêntico ao da 096a, mais o enfileiramento isolado;
- as respostas por WhatsApp e por e-mail enfileiram `lead.connected`;
- desconectar apaga a fila;
- trocar colunas sempre cria uma planilha nova;
- os valores são gravados como RAW.

Os quatro Important e os menores baratos foram corrigidos numa passagem RED→GREEN (migração 098a e commit 5f8fa19), sem segunda revisão. Os três testes da revisão falharam sem as correções e passaram com elas.

| Achado | Correção | Regressão |
|---|---|---|
| Uma resposta grande ou ilegível virava "cabeçalho alterado", sem saída | Resposta OK ilegível vira nova tentativa; as chamadas usam `prettyPrint=false` | 200 truncado deixa o lead pendente, sem atenção |
| Um único 401 exigia reconexão manual | Um 401 força uma renovação e repete a chamada uma vez; só então pede reconexão | 401 isolado exporta depois de uma renovação; o acesso renovado é salvo e reaproveitado |
| A exportação atrasava os webhooks no mesmo lane, e importações grandes esgotavam a cota | Lane próprio `sheets` e orçamento de 20 s por tick; 429 e 403 de API desativada voltam com `Retry-After` | 429 com `Retry-After` de 600 s e 403 `SERVICE_DISABLED` ficam pendentes, sem atenção |
| Os testes não cobriam PKCE e vários casos de falha | Falso Google confere o verificador e o `redirect_uri`; novos testes para renovação, cota, `again`, lead apagado, resposta por e-mail e WhatsApp, e reconexão no meio da exportação | 8/8 |

Menores corrigidos:
- **Coluna A:** vem da fila, nunca do payload; um id vazio é recusado.
- **Resultado de um acesso antigo:** é descartado depois de uma reconexão e não marca atenção.
- **Reexportação:** ganha uma janela de 24 h nova.
- **Nova planilha:** não retoma uma exportação pausada nem limpa uma reconexão pendente.
- **Tokens no worker:** só são salvos com o lease da exportação.
- **`Retry-After`:** em formato de data agora é lido.
- **Lead apagado:** é cancelado, sem contar como exportado.
- **Interface:**
  - o aviso de falha do OAuth usa `role="alert"`;
  - "Nova planilha" parte do nome e da aba atuais;
  - o resumo de Apps mostra "escolha a planilha" quando a conta está conectada sem planilha.

## Menores adiados (owner 08A/08B)

1. **Coluna A inteira:** é lida a cada exportação, e não há lote por conexão. Uma planilha muito grande ou uma importação em massa consome cota (08B, carga).
2. **Ordem das linhas:** se alguém ordena ou apaga linhas entre a leitura e a escrita, a escrita pode cair na linha de outro lead. A janela é estreita.
3. **Planilha na lixeira:** ainda aceita escrita e não vira "planilha não existe" (não verificado).
4. **Escopo:** a checagem só confirma que `drive.file` está presente; escopos extras não são recusados.
5. **Lead apagado:** a linha dele continua na planilha do cliente (questão de privacidade para o 08A).
6. **Mensagem de sucesso:** é anunciada em região viva e também aparece visível.
7. **Nome da aba inválido:** só desativa o botão, sem mensagem junto ao campo.
