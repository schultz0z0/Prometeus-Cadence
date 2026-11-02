# Revisão final — 06F.2

02/11/2026. Revisão independente feita por um subagente somente leitura, em contexto novo, sobre o intervalo imutável c6719d4..720b1b4. Sem Critical: toda escrita passa pela proposta gravada, pelo prepare/confirm do serviço da área e pelo token de revisão; o cliente não envia o corpo do comando, e nada é enviado. Seis Important e os menores baratos foram corrigidos numa passagem RED→GREEN (migração 094a e commit 384fe53), sem segunda revisão.

| Achado | Correção | Regressão |
|---|---|---|
| Uma confirmação iniciada antes do vencimento terminava em "venceu" mesmo com o job criado | O vencimento só barra uma confirmação nova; proposta já reivindicada pode terminar depois do prazo (094a) | Teste com claim, job criado e prazo vencido: confirma com o mesmo job |
| Queda entre o job e o fim da confirmação, seguida de outro id, podia criar um segundo job | Antes de reivindicar, o serviço procura o job já criado pelo id reivindicado e termina a proposta com ele; a liberação só ocorre quando nada foi criado | O mesmo teste: contagem de jobs inalterada |
| O texto recebido de contatos ia ao modelo em toda pergunta | O texto só entra quando a pergunta é sobre responder; nas demais vão apenas IDs e nomes. O catálogo é marcado como dado de terceiros | Pergunta sobre Gmail sem o texto; pergunta de resposta com o texto |
| Nome longo de lista ou contato podia derrubar a resposta pelo limite do resumo | Nomes cortados em 80 caracteres no resumo. A importação já limita nomes a 250, então o corte é defesa em profundidade | Lista com nome de 250: resumo dentro do limite |
| O rascunho não era lido quando a caixa já estava aberta | O link "Abrir" do rascunho faz navegação completa | QA de código |
| A qualificação parava em 500 contatos sem avisar | A revisão avisa "cobre 500 de N contatos" | Lista de 600: aviso presente |

Menores corrigidos:
- **Proposta inválida da IA:** é descartada sozinha, e o texto da resposta é mantido (teste).
- **Prazo exibido:** a revisão não mostra prazo além do da proposta.
- **Parâmetro `draft`:** é removido da URL depois de aplicado, para recarregar a página não preencher o compositor de novo.
- **Cards de passeio:** mapeados pelo id do primeiro passo do grupo, com o passeio geral como padrão.

Itens verificados e mantidos:
- **Hidratação da investigação:** o `leadId` lido da URL só alimenta a consulta e não aparece no HTML inicial; segue o mesmo padrão já usado em Sócios e gestores.
- **Fechar o passeio com Esc:** não grava progresso. É intencional: só "Concluir" marca o passeio como visto.

## Menores adiados (owner 08A)

1. O card de proposta não se atualiza sozinho ao vencer nem quando outra aba confirma; o servidor responde 409 e o card mostra o erro.
2. O catálogo enviado à IA é estreito (30 listas por nome e 5 conversas); fora dele, a proposta vira nula sem aviso.
3. A liberação silenciosa do claim e a segunda leitura do progresso depois de concluir um passeio.
4. Os comandos de planejamento não têm teste de confirmação dedicado; a qualificação e o rascunho cobrem o caminho comum de claim e finish.
