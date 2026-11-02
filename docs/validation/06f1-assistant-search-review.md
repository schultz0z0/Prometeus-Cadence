# Revisão final — 06F.1

02/11/2026. Revisão independente feita por um subagente somente leitura, em contexto novo, sobre o intervalo imutável 18c60a2..9790c21. Sem Critical: isolamento por workspace e por usuário, grants, `search_path` das funções `SECURITY DEFINER`, revalidação depois da IA e ausência de caminho de mutação foram confirmados. Três Important e os menores baratos foram corrigidos numa passagem RED→GREEN (migração 093a e commit 734fdab), sem segunda revisão.

| Achado | Correção | Regressão |
|---|---|---|
| Repetir o mesmo `requestId` (em paralelo, ou abortando e repetindo) chamava a IA de novo sem contar no limite | Cada pergunta tem um lease de geração de 90 s e no máximo 3 tentativas. Repetição com lease ativo recebe 409 `ASSISTANT_BUSY`; depois de 3 tentativas a resposta vem da Central de Ajuda, sem IA | Três POSTs paralelos davam 3 chamadas, agora 1. O ciclo abortar e repetir parou em 3 |
| Pergunta enviada antes de o histórico carregar, ou depois de falhar a leitura, sumia do painel | O envio só é liberado com o histórico carregado. A resposta substitui a pergunta pelo `requestId` | QA no navegador |
| "Mostrar mais" da busca não acompanhava o termo atual | Usa o controlador do termo atual, é abortado ao digitar e descarta resposta tardia | Revisão de código; não há teste de componente no projeto |

Menores corrigidos na mesma passagem:
- **Rascunho:** volta ao composer quando o envio falha.
- **Pergunta órfã** (painel fechado no meio da resposta): ganha "Tentar de novo" com o mesmo `requestId`.
- **Esc:** com um modal aberto por cima, uma tecla fecha só uma camada (verificado com tecla real).
- **Perguntas restantes:** respeitam também o limite do workspace, e a resposta devolve o saldo do servidor (teste).
- **Lock:** os fatos da conta e a rota da IA saem da transação que segura o lock do assistente.
- **Histórico:** limitado às últimas 50 mensagens.
- **ARIA:** a lista de resultados usa grupos válidos, e "Nada encontrado" não pisca durante o debounce.
- **Busca:** ignora acentos e caixa ("joao" encontra "João"), e `kinds` inválido tem mensagem própria (teste).

Itens verificados e mantidos:
- **Formato do evento de cota do ChatGPT:** o evento real capturado em 02/11 tinha `error.code` aninhado, como a correção lê.
- **Corpo da requisição:** o tamanho é checado depois da leitura, como nas demais rotas; o limite real é o do servidor.

## Menores e limites adiados

1. O histórico do assistente segue a vida do usuário. A RLS esconde o histórico de quem saiu do workspace, mas a retenção do 06E.2 não o apaga. Decidir a retenção no 08A.
2. O "Mostrar mais" atrasado não tem teste automatizado de componente (owner 08A).
3. Busca sem índice de texto (owner 08B).

Verificação depois das correções: focada 9/9 e 375/375 unitários; a suíte completa de integração e o build estão registrados no [relatório](06f1-assistant-search.md).
