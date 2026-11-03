# Revisão final — 07A.0

03/11/2026. Revisão independente feita por um subagente somente leitura, em contexto novo, sobre o commit 835ac39. Não houve Critical.

Foram confirmados:
- **Funções SECURITY DEFINER:** todas fixam `search_path=pg_catalog`, com nomes qualificados e PUBLIC revogado.
- **Tabela sem grant:** os papéis do app não têm acesso direto à tabela; o worker só recebe a função de leitura.
- **Atestados concorrentes:** a trava consultiva vem antes das checagens de revisão e de adaptador ativo.
- **Revisões:** são coerentes entre atestar, revogar e reatestar.
- **Resposta ao membro:** o GET não traz contrato, evidência nem `verified_by`. A UI mostra o motivo do servidor e não oferece ação nova.

Os três Important e os menores baratos foram corrigidos numa passagem RED→GREEN (migração 100a e commit 0733079). Os testes novos falharam antes da correção: 1 unitário e 2 de integração (vencimento e corpo estrito). Os outros testes novos reforçam asserções que já passavam.

| Achado | Correção | Regressão |
|---|---|---|
| O vencimento usava `now()`, congelado no início da transação. A segunda checagem da trava, depois do I/O, não via uma habilitação que vencesse no meio | `linkedin_capability_state()` passa a usar `clock_timestamp()` e é `VOLATILE` | Duas checagens na mesma transação, com o vencimento no meio: a segunda dá 409 |
| `sendMessage!=='unavailable'` liberava valores malformados, e `profileActions` ausente lançava erro (503) | O domínio só aceita os valores conhecidos e confere `Array.isArray`. A leitura revalida o perfil gravado com o esquema, e um perfil inválido conta como "nenhum fornecedor" | Teste unitário com perfil malformado; perfil gravado inválido dá NO_LINKEDIN e 409 na trava |
| `.and()` desligava o `.strict()` do corpo do atestado | O esquema passa a usar `.extend({expectedRevision}).strict().superRefine(...)` | Uma chave extra dá 422 |

Menores corrigidos:
- **Escrita direta:** o teste agora exige o código `42501`, com uma linha completa.
- **CHECK de oficial automático:** um teste chama a função SQL diretamente e espera `23514`.
- **Segredos:** o GET também não pode trazer o caminho da evidência nem o id de quem atestou.
- **Violação do índice único:** um `23505` vira `ADAPTER_ACTIVE` (409), e não 503.
- **Falha da página:** um erro ao ler as capacidades mostra o aviso genérico de pendente. O layout continua fazendo os redirecionamentos.
- **`adapterId` na revogação:** usa a mesma regex do atestado.

## Menores aceitos ou adiados

1. **Adaptador vencido segura a vaga.** Um adaptador vencido e não revogado continua ocupando a vaga única. É intencional: trocar de fornecedor exige revogar o anterior de forma explícita, e isso fica registrado.
2. **Mensagem de `LINKEDIN_INVALID`:** fala só de validade. Hoje é o único caso que o SQL levanta, porque os outros inválidos param antes, no Zod.
3. **Executores:** os do 07A.1 a 07A.3 precisam chamar a trava em READ COMMITTED, antes e depois de cada I/O. Fica como critério de aceite desses pacotes.
