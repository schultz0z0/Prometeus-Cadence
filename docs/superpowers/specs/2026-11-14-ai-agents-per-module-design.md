# Agentes de IA por módulo (fase 1: separar sem mudar)

Data: 14/11/2026. Pedido do operador. Status: aguardando aprovação.

## Intenção

Hoje toda a IA do app é uma coisa só: uma configuração da plataforma (um provedor, um modelo por provedor), usada por 7 pontos que carregam as próprias instruções espalhadas no código. O operador quer **um agente de IA por módulo** (prospecção, LinkedIn, assistente do app, Agente SDR), em prol de qualidade e escala com muitos usuários: cada agente evolui sem afetar os outros, e o SDR pode ficar mais robusto que os demais.

Esta fase **só separa**. O comportamento tem de continuar idêntico ao homologado, provado por testes, antes de qualquer melhoria. A melhoria do SDR (base de documentos, busca e memória: `2026-11-14-sdr-knowledge-memory-design.md`) vem depois, já sobre o agente SDR.

## Metas

1. Quatro agentes com identidade própria: `prospecting`, `linkedin`, `assistant`, `sdr`.
2. Cada ponto que chama IA declara de qual agente e qual operação é; um agente não executa operação de outro.
3. **Provedor igual para todos** (o da plataforma). **Modelo escolhível por agente** pelo administrador da plataforma; o padrão de cada agente é "o modelo da plataforma", o mesmo de hoje.
4. Instruções base de cada agente reunidas num lugar por agente, **com o mesmo texto de hoje**.
5. Uso de IA marcado com o agente que gerou.
6. Prova de que nada mudou: o pedido enviado ao provedor por cada ponto é byte a byte igual ao de antes, com o modelo padrão.

## Fora do escopo

- Mudar qualquer instrução, formato de saída, limite ou modelo efetivo (nesta fase o operador mantém o mesmo modelo para todos).
- Provedor diferente por agente (decisão do operador: provedor único).
- Base de documentos, busca e memória do SDR (fase 2, desenho próprio já aprovado).
- Relatório consolidado de custo por agente (o registro passa a ter o agente; o relatório vem depois).
- Fila com prioridade: o SDR já roda numa trilha própria do worker (`sdr`), separada dos jobs de prospecção; nada a fazer.

## Anti-metas

- Qualquer diferença de comportamento visível, de custo ou de qualidade nos fluxos já homologados.
- Um workspace comum conseguir ver ou mudar os modelos por agente (é configuração da plataforma).
- Uma operação rodar com o agente errado sem erro (ex.: simulação do SDR contando como prospecção).

## Mapa dos pontos de IA

| Agente | Operações (pontos de hoje) |
|---|---|
| `prospecting` | qualificação e enriquecimento (`src/server/prospecting/service.ts` e jobs), pesquisa de empresa (`research/journey.ts`, `research/evaluation.ts`), planejamento e scripts de cadência (`planning/service.ts`, `planning/model.ts`) |
| `linkedin` | comentário (`linkedin/comment-ai.ts`), aprovações (`linkedin/approvals.ts`) |
| `assistant` | chat do app (`assistant/service.ts`), automações (`automations/state.ts`) |
| `sdr` | turno de resposta (`sdr/worker.ts`), simulação (`sdr/configuration.ts`) |

## Desenho

### 1. Registro de agentes (domínio)

Um arquivo de domínio define os quatro agentes: id, nome exibido, operações permitidas e os limites que cada ponto usa hoje (tokens de saída, tempo máximo). Os valores são copiados dos pontos atuais, sem arredondar.

### 2. Rota por agente

- A resolução de rota atual continua igual e ganha o agente como entrada: se houver modelo escolhido para aquele agente, ele substitui o modelo da rota; senão vale o modelo da plataforma.
- A impressão digital da configuração (`configFingerprint`) inclui o modelo efetivo, como hoje; com o padrão, ela não muda, então os testes de conexão já feitos continuam valendo.
- A chamada central de IA recebe `agent` e `operation` e recusa operação que não pertença ao agente.

### 3. Modelos por agente (configuração)

- Guardados junto da política de IA da plataforma: um mapa `agente → modelo`, vazio por padrão.
- O modelo escolhido precisa estar na lista de modelos do provedor atual (a mesma lista que a tela de chaves já mostra). Ao trocar o provedor da plataforma, o mapa é limpo e todos voltam ao padrão.
- Só o administrador da plataforma lê e altera, com o mesmo controle de revisão e auditoria da política atual.
- Tela: na configuração de IA, uma seção **"Modelo por agente"** com quatro linhas (Prospecção, LinkedIn, Assistente, Agente SDR), cada uma com "Padrão da plataforma (<modelo>)" e os modelos disponíveis. Nesta fase todas ficam no padrão.

### 4. Instruções por agente

As instruções base saem dos pontos espalhados para um módulo por agente, sem mudar uma letra. Antes de mover, testes de "pedido de referência" capturam o pedido exato (prompt, formato e limites) de cada operação com entradas fixas; depois de mover, os mesmos testes têm de passar sem atualizar a referência.

### 5. Uso por agente

O registro de uso que cada chamada já devolve (`ProviderUsage`) ganha o campo `agent`, gravado onde cada módulo já guarda uso (jobs de prospecção, turnos do SDR e afins). Registros antigos ficam sem agente.

### 6. Prova de que nada mudou

- Testes de pedido de referência por operação (seção 4), escritos **antes** de qualquer mudança.
- Todas as suítes atuais de unidade e integração passando.
- Rodada real curta no ambiente local (build de produção): um job de qualificação, uma simulação do SDR, uma pergunta ao assistente e, se o LinkedIn estiver conectado, um comentário em rascunho; conferir que funcionam como antes.

## Decisões do operador

- Um agente por módulo: prospecção, LinkedIn, assistente do app, Agente SDR.
- Provedor único para todos; modelo escolhível por agente pelo administrador.
- Nesta fase, todos usam o modelo de hoje.
- Separar e provar a mesma qualidade antes de melhorar o SDR.

## Decisões do desenho (podem ser corrigidas)

- Pesquisa de empresa e planejamento de cadência ficam com o agente de prospecção; automações ficam com o assistente.
- Modelo por agente guardado na política de IA da plataforma e limpo ao trocar de provedor.
- Prova por pedido de referência byte a byte, além das suítes atuais.

## Deixado para quem constrói

- Nome e formato exatos do registro de agentes e do mapa de modelos no banco.
- Como cada módulo grava o campo `agent` no uso que já persiste.
