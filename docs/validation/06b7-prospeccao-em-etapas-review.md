# 06B.7 — Revisão independente

Revisão somente leitura por um agente separado, sobre `963d8ba..0b58ad2`, em 10/11/2026. Não executou testes nem navegador. Resultado: nenhum achado crítico, nove importantes e oito menores. Depois da revisão, o operador decidiu que o Enriquecedor age em qualquer lead com CNPJ válido, o que substituiu parte dos achados.

## Importantes

| # | Achado | Destino |
| --- | --- | --- |
| I1 | O worker ainda avança jornadas integradas em andamento, e a reconciliação pode reabrir uma jornada bloqueada | Corrigido após decisão do operador: o worker não enfileira a próxima etapa e a reconciliação não reabre a jornada |
| I2 | "Pausar jornada" ficou irreversível sem aviso | Corrigido: "Encerrar jornada" com aviso |
| I3 | Link e mensagem órfãos na cadência de jornada antiga | Corrigido: o link gera nova análise para a lista |
| I4 | A tela prometia cache que não existe entre os dois caminhos | Corrigido: frase removida |
| I5 | Reserva e requisitos diferentes entre lote clássico e `companyPeople` | Registrado no relatório; a tela só usa o clássico |
| I6 | CNPJ malformado derrubava o lote inteiro | Corrigido: a tela usa a mesma regra de formato do servidor |
| I7 | Lead com CNPJ e não qualificado ficava fora dos dois lotes | Resolvido pela decisão do operador |
| I8 | Teto por lote do caminho clássico sem teste | Corrigido: teste novo, que revelou a exigência de lead qualificado no banco (migração 114) |
| I9 | Lacunas dos testes novos frente ao plano | Parcial: 409 coberto para `resume` com confirmação, `confirm-cadence`, workspace alheio e viewer, com contagem de listas. Seguem sem teste novo: lista existente, deduplicação, falha e parcial por fonte, franquias, evidência ambígua e papéis no lote clássico |

## Menores adiados

- Testes que afirmam sobre texto-fonte quebram com reformatação.
- A asserção de `dispose()` seguido de leitura da jornada saiu junto com o teste do cliente removido.
- `eligibleIn` reordena todos os leads a cada render.
- Texto "1 empresas" no preview.
- Funções de serviço da jornada sem chamador de produção e dois bloqueadores que ainda dizem "Prospecção completa" em `journey.ts`.
- Ação desconhecida em `/journeys/{id}/{x}` passou de 404 para 409.

Os dois menores sobre o botão "Investigar sem CNPJ" (layout da célula e `title` como única explicação) deixaram de existir com a remoção do botão.

## Fora do alcance da revisão

Execução das suítes, fidelidade visual com a referência, cobertura das suítes antigas para deduplicação e franquias, e conteúdo de ajuda fora de `src`.
