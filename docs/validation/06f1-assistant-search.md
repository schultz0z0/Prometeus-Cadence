# 06F.1 — Busca global e assistente de ajuda e conta

Data: 02/11/2026. Estado: concluído local/controlado após revisão independente ([revisão](06f1-assistant-search-review.md)). [Plano do pacote](../superpowers/plans/2026-11-02-prometeus-cadence-06f1-assistant-search.md). Não é aceite de paridade 100%, de produção pública nem do 06F inteiro: os 4 comandos propostos, `onboarding_progress`, tours por rota e os menores herdados ficam no 06F.2.

## Contrato entregue

- **Busca global (Ctrl K).**
  - Modal no topo, como a referência: placeholder "Buscar lead, cadência ou página…", dica vazia e rodapé de teclas.
  - Resultados do workspace ativo:
    - leads, por nome, empresa, e-mail ou telefone com 4 dígitos ou mais;
    - cadências não arquivadas;
    - listas;
    - páginas do menu, com a seção de origem.
  - Navegação: ↑↓ mudam a seleção, Enter abre e Esc fecha e devolve o foco.
  - A paginação usa cursor por chave. O `%` e o `_` digitados valem como texto literal.
  - Conteúdo excluído ou fundido some, porque a busca lê as tabelas vivas sob RLS.
- **Assistente lateral.**
  - Painel flutuante à direita, sem bloquear a página, com a geometria da referência.
  - Cabeçalho com "nova conversa" e fechar.
  - Card "Pra hoje" com no máximo um item derivado de fatos objetivos: sem canal pronto, sem leads ou sem cadência ligada. O card traz o destino real, "Perguntar" e "dispensar".
  - Boas-vindas com três sugestões, histórico da conversa e composer (Enter envia, Shift+Enter quebra linha).
  - Rodapé "Com base na Central de Ajuda e na sua conta".
- **Respostas.**
  - As fontes são somente os artigos do manifesto local de ajuda (17 artigos próprios com destinos reais) e os fatos da conta: leads, listas, canais prontos, cadências e estado do plano.
  - A IA central é a rota da política da plataforma, limitada a provedores HTTP; o Codex local depende de slot de job.
  - A saída passa por Zod, e as citações fora das fontes fornecidas são descartadas.
  - Sem rota, com falha ou com saída inválida, a resposta vem do melhor artigo, marcada "Central de Ajuda".
  - O assistente nunca executa ações: pedidos de ação recebem a explicação e o destino.
- **Persistência e autoridade (migração 093).**
  - O histórico é privado por usuário e workspace (RLS de leitura, escrita só por funções `SECURITY DEFINER`).
  - A pergunta é gravada antes do I/O. Repetir o `requestId` devolve a mesma resposta sem nova chamada; o mesmo id com outro texto recebe 409.
  - Limites de 30 perguntas por usuário e 200 por workspace por dia, com lock.
  - A resposta só é gravada depois de revalidar a associação: um membro removido durante a chamada recebe 403 e nada é gravado.
- **Central de Ajuda.** Modal com os artigos da área atual primeiro, filtro por texto e "Ir para a área".
- **Correção herdada do 06IA.** A cota do ChatGPT enviada como evento SSE `error` antes de `response.failed` agora vira `CHATGPT_QUOTA_EXCEEDED` em vez de resposta incerta.

## Validação executada

- **Unitários:** 4/4 no domínio (permissão não ampliada pela confirmação, manifesto com destinos reais, limites de entrada e citações, card "Pra hoje") e 3/3 no OAuth do ChatGPT.
- **Integração focada:** 9/9, sendo 7 originais e 2 da revisão: lease de geração com limite de tentativas, acentos e caixa na busca, `kinds` inválido e saldo pelo limite do workspace.
  - busca isolada por tenant, por nome, e-mail, telefone e lista, com paginação, curinga literal e conteúdo excluído;
  - resposta com IA injetada, citações filtradas e pergunta com injeção sem mutação (contagens de 7 tabelas iguais);
  - fallback sem rota e com saída inválida;
  - replay sem segunda chamada e texto alterado com 409;
  - histórico privado por usuário, conversa alheia com 404 e limite diário com 429;
  - membro removido durante o I/O;
  - contrato HTTP 401/422/409/403.
- **Suítes completas:** 375/375 unitários, 486/486 integrações, build e tipos exit 0, `git diff --check` limpo.
- **RED:** o domínio falhou antes de existir. Duas mutações deliberadas foram detectadas pela suíte: citações sem filtro e LIKE sem escape. O caso de cota em evento `error` falhou antes da correção.

QA real no navegador, com o banco operacional local, a conta descartável `[RE] QA Assistente` e três leads `[RE]` fictícios: medidas em [qa-geometry.json](evidence/06f1-assistant-search/qa-geometry.json), capturas na mesma pasta.

## Visual e referência

A 1920×855:

| Elemento | Prometeus | Referência |
|---|---|---|
| Painel do assistente (x, y, largura × altura) | 1421, 211, 460×620 | ≈1438, 213, 456×617 |
| Paleta de busca (x, y, largura × altura) | 665, 120, 576×162 | ≈672, 120, 576×163 |
| Composer (y) | 732 | ≈741 |

Em 390 e 320 px não houve overflow.

Diferenças registradas:
- O rodapé da referência tem "Suporte por e-mail" e "Falar com vendas". O Prometeus não tem canal de suporte real, então oferece Central de Ajuda, Primeiros passos e Contexto de IA, sem endereço inventado.
- O texto de boas-vindas e os artigos de ajuda são próprios. O componente de chat da referência não está nos bundles retidos; a forma das respostas, o modelo e o backend dela não foram observados.
- A aparência das mensagens da conversa é própria, porque a referência não foi capturada com uma conversa.
- As capturas do painel saem com resolução reduzida (800 px de largura para um viewport de 1920).

## QA, runtime e custos

- **L-029 removed:** usuário, workspace `[RE] QA Assistente`, 66 linhas de app, membro, sessão, conta, pedido de workspace e organização, removidos por IDs exatos. Nenhum dado do operador foi alterado. E-mails de cadastro só no capturador local.
- **Migrações:** 093/093a aplicadas localmente.
- **Runtime:** inalterado, sem lane novo.
- **Custo externo:** chamadas à IA central da plataforma recusadas por cota da assinatura; zero envios, Actors ou cobranças.
- **Entrega:** sem merge, push ou deploy.

## Limites

- **IA real.** A rota central (`chatgpt-oauth` da plataforma) respondeu `subscription_sharing_usage_limit_exceeded`, um limite externo da assinatura. Todas as respostas da QA vieram do fallback da Central de Ajuda. Uma resposta real da IA não foi observada neste pacote; o caminho com IA está coberto por integração com o gerador injetado.
- **Consumo.** O assistente conta pelos seus próprios limites diários, não pelo `usage_ledger` dos jobs; os tokens ficam gravados na resposta.
- **Desempenho da busca.** A busca usa `LIKE` sem índice de texto, adequado ao volume local. Bases grandes vão pedir índice trigram, que fica para o 08B.
- **Fora do escopo.** Conversas e execuções não entram na busca deste pacote; o lead aberto pela busca mostra as duas.
