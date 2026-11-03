# Revisão final — 07A.1

03/11/2026. A revisão foi feita por um subagente independente, somente leitura e em contexto novo, sobre o commit 7398f8b. Não encontrou nada Critical.

Itens confirmados pela revisão:
- **Segredos:** o token do aviso e o `state` têm 256 bits e são guardados só como hash SHA-256, com índice único. Nunca aparecem numa resposta ao cliente, e o callback responde com `no-referrer`.
- **Avisos falsos:** um token desconhecido não provoca chamada ao fornecedor. O mesmo aviso repetido não muda nada; outra conta com o mesmo token dá 409.
- **Unicidade entre workspaces:** índices únicos parciais para a conta do fornecedor e para o membro LinkedIn.
- **Permissões de acesso:**
  - `cadence_app` não lê o id do fornecedor, o lease nem as tentativas (testado com 42501);
  - as funções de vínculo e de entrada pertencem só ao `cadence_ingress`;
  - as do worker, só ao `cadence_worker`.
- **Leitura da trava pelo papel do serviço:** a checagem por `session_user` é segura e segue o precedente das migrações 067, 070 e 080.
- **Concorrência na verificação:** lease, época e token descartam resultados atrasados.
- **Reconexão:** não existe ciclo automático de reconectar.

Os quatro Important e os menores baratos foram corrigidos numa passagem RED→GREEN, na migração 101a. Antes da correção, 7 dos 11 testes de integração falhavam.

| Achado | Correção | Regressão |
|---|---|---|
| O aviso da Unipile sozinho vinculava a conta. Quem gerasse o link podia encaminhá-lo a outra pessoa, e o login dela entraria no workspace de quem gerou | O aviso só registra a conta verificada na tentativa. O vínculo acontece quando também volta o navegador de quem iniciou, com o mesmo usuário e a mesma sessão, em qualquer ordem | Aviso sem retorno não vincula. O retorno da vítima dá 403, e o login expira sem conta. Com o retorno primeiro, o aviso depois vincula |
| Ordem de travas invertida entre vincular e revogar ou iniciar, com risco de deadlock | O vínculo trava na mesma ordem do `connector_actor()`: membro, trava consultiva do workspace, tentativa e conta | Coberto pela ordem única. A concorrência real não foi reproduzida em teste |
| Sessões órfãs no fornecedor: aviso recusado (tentativa velha, autor removido, trava desligada, conta já existente) ou login verificado que nunca voltou | Nova tabela `linkedin_orphan`, preenchida no aviso e pelo worker para tentativas encerradas. Só entra uma conta que não esteja viva nem verificada numa tentativa aberta; uma conta de outro workspace nunca é removida | O aviso de uma tentativa velha e a trava desligada apagam a sessão no fornecedor. O caso `TAKEN` não apaga nada. O login expirado é removido pelo worker |
| A reconexão aceitava outro membro LinkedIn na mesma conta do fornecedor | Membro diferente dá `LINKEDIN_ACCOUNT_MISMATCH`, e a conta viva nunca é apagada | Teste de reconexão com outro membro |

Menores corrigidos:
- **Reconectar durante a verificação** responde `LINKEDIN_CHANGED`, não "desconectada".
- **Retry-After:** um 429 espera pelo menos o que o fornecedor pediu (limitado a 24 h).
- **Aviso de retorno forjado:** `?linkedin=connected` só diz "conectada" se o servidor mostra a conta. O parâmetro sai da URL depois da primeira leitura.
- **Leitura da página:** se a leitura da conta falhar, a trava continua aparecendo.
- **Endereços de retorno:** o navegador volta para `BETTER_AUTH_URL`, onde vive a sessão; só o aviso usa `LINKEDIN_PUBLIC_URL`.
- **Worker com a trava desligada:** não consulta o fornecedor para verificar contas; remoções seguem.
- **Corpo do aviso:** o `content-length` é conferido antes de ler o corpo.
- **Testes novos:** o worker lê a trava (um reatestado volta a ficar pronto depois de um tick) e o callback HTTP sem sessão redireciona com `failed`.

## Menores aceitos

1. **Rebaixamento durante a verificação:** se o autor perde o papel entre o início e o fim da verificação, o resultado se perde e o lease segura a conta por 60 s.
2. **Corpo malformado do fornecedor:** respostas sem `connection_params.im` ou que não são JSON viram nova tentativa ou erro. A paginação de busca e relações chega no 07A.2.
