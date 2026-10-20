# JEV 1.13 e IA híbrida para o Prometeus Cadence

Estudo documental de 20/10/2026, solicitado pelo usuário antes do marco 03. Modelo preservado: `typesafe/jev-1.13`, via OpenRouter. Não houve chamada de inferência ao JEV, teste de precisão, medição de throughput ou consumo de créditos. Os resultados abaixo distinguem contrato publicado, cálculo hipotético e proposta de arquitetura.

## Conclusão

JEV faz sentido como componente principal da **decisão de qualificação em volume**, junto de regras determinísticas e evidências coletadas. Para **gerar resumo, justificativa livre ou mensagem**, usar o componente generativo. Na fase local, a preferência do usuário é Codex CLI com seu login ChatGPT. Não precisamos trocar o JEV por um chat model; precisamos atribuir responsabilidades diferentes aos dois.

O objetivo é evitar pagar uma geração de texto para cada registro que só necessita de um rótulo. Também não faz sentido chamar os dois modelos em todos os leads se a tarefa já pode ser resolvida por regras ou por uma decisão estruturada.

## O que o JEV realmente oferece

A [página do modelo](https://openrouter.ai/typesafe/jev-1.13) descreve um modelo de decisões, com entrada de estado e saída tipada. A [documentação de integração](https://openrouter.ai/docs/guides/community/jev) esclarece que ele não gera prosa nem explicações livres e não substitui diretamente um modelo de chat.

As primitivas úteis para este produto, documentadas em [Questions](https://docs.typesafe.ai/primitives), são:

| Primitiva | Aplicação proposta |
| --- | --- |
| `choice` | Uma categoria exclusiva: dentro do perfil, fora do perfil ou evidência insuficiente |
| `noul` | Probabilidade de um critério ser verdadeiro, por exemplo a empresa oferecer o serviço procurado |
| `score` | Faixa ordenada de aderência ao perfil, com níveis explicitamente definidos |

Não usar nomes como “ruim/médio/bom” sem definir os critérios. “Tem site” é um dado verificável, não uma prova de aderência comercial. Box/imagens não são necessárias ao marco 03 e não entram no contrato do JEV 1.13.

O endpoint de decisões publicado é `POST https://openrouter.ai/api/alpha/decisions`, com `model`, `state` e `questions`. Não enviar esse corpo ao endpoint de chat completions. A resposta contém `answers`, com tipos distintos por primitiva, além dos campos de uso disponíveis. O adaptador validará as respostas com o Zod já instalado. Fonte: [Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request).

O guia geral já mostra outra versão mais nova, mas isso não muda a escolha: continuar em `typesafe/jev-1.13`, sem alias `latest`, Jev Router ou upgrade automático. A compatibilidade é testada contra o contrato e a versão configurados.

## Limites relevantes ao nosso caso

1. **Dados antes da decisão:** o modelo avalia o conteúdo enviado. Busca, leitura de site, obtenção de contatos e checagem cadastral são responsabilidades dos adaptadores. Um rótulo não cria evidência que faltava.
2. **Português precisa de avaliação própria:** a TypeSafe informa treinamento predominantemente em inglês e menor precisão em outros idiomas. Comparar instruções PT/EN sobre as mesmas evidências PT-BR, sem presumir que traduzir tudo melhore qualidade ou custo. Fonte: [State](https://docs.typesafe.ai/concepts/state).
3. **Confiança não é acurácia medida:** a [documentação primária](https://docs.typesafe.ai/confidence) define `confidence` a partir da distribuição das respostas. Um valor 0,9 não comprova 90% de acerto em leads brasileiros. Os limiares devem ser escolhidos em exemplos rotulados por pessoas, por tarefa e perfil.
4. **Explicação auditável:** o JEV pode escolher critérios/motivos previamente definidos. Exibir texto determinístico desses motivos junto das fontes. Quando uma justificativa livre for solicitada, usar o generador e verificar se ela é sustentada pelas evidências.
5. **Instabilidade do contrato:** a rota escolhida está sob `/alpha/`. Isolar transporte e decoder, manter fixtures e testes de incompatibilidade. Um erro nunca vira “desqualificado”.
6. **Capacidade efetiva:** páginas consultadas apresentam limites de contexto divergentes entre versões de página. Não assumir um contexto máximo com base na vitrine; consultar metadados na configuração e enviar evidência pequena, suficiente e limitada. A proposta começa com até 12.000 caracteres de evidência por lead, sem truncar silenciosamente o critério essencial.

## Distribuição de trabalho proposta

| Trabalho | Responsável |
| --- | --- |
| Encontrar empresas, sites e dados cadastrais | Apify/Apollo e adaptadores de fonte |
| Normalizar CNPJ/domínio/contatos, deduplicar, aplicar filtros objetivos | Código determinístico no servidor |
| Julgar aderência a critérios e atribuir categorias | JEV 1.13 |
| Caso ambíguo com evidência suficiente | Segunda análise generativa, se habilitada e dentro do orçamento; caso contrário, revisão |
| Caso sem informação suficiente | Coletar mais evidência ou marcar pendente; não escalar apenas para obter um palpite |
| Resumo comercial e texto livre | Gerador; Codex CLI no ambiente local de testes |
| Confirmar rascunhos e autorizar criação/execução | Pessoa, pelos botões do produto |
| Permissões, cotas, cobrança, envio e transações | Servidor, sem delegar autoridade ao modelo |

Para o fluxo em massa: **coletar → normalizar/filtrar → JEV → persistir decisão com fonte → gerar texto somente quando necessário**. A geração sob demanda ou apenas para aprovados evita produzir resumos para milhares de empresas descartadas. Se o usuário selecionar resumo para toda a lista, o preview deve apresentar esse custo adicional.

Há também o padrão **rascunhar → verificar com JEV → escalar** no [cookbook do OpenRouter](https://openrouter.ai/docs/cookbook/evaluate-and-optimize/jev-verified-cascade). Ele é útil para conferir textos contra fontes, mas acrescenta uma chamada de verificação; não se deve assumir economia para qualquer tarefa. A redução publicada naquele exemplo não é resultado medido neste SaaS. Nesta entrega, esse verificador é uma capacidade opcional e não um bloqueio extra para todos os campos.

## Custo: cálculo ilustrativo

A página consultada anuncia **US$0,042 por milhão de tokens de entrada e US$0 de saída** para o JEV 1.13. Não é preço fixado pelo produto. Fonte: [modelo no OpenRouter](https://openrouter.ai/typesafe/jev-1.13).

Com **2.000 tokens de entrada faturados por lead**, incluindo estado, critérios e demais entradas efetivamente cobradas:

| Volume | Tokens de entrada | JEV, valor ilustrativo |
| --- | --- | --- |
| 10.000 leads | 20 milhões | US$0,84 |
| 100.000 leads | 200 milhões | US$8,40 |
| 1.000.000 de leads | 2 bilhões | US$84,00 |

Fórmula: `leads × média de tokens faturados / 1.000.000 × preço de entrada`. Esses valores não incluem coleta Apify, Apollo, geração, retries, taxas adicionais, armazenamento ou infraestrutura. Não houve medição de tokens por lead; a hipótese de 2.000 é apenas uma entrada do cálculo. Se forem 10.000 tokens por lead, o custo do exemplo quintuplica.

O custo híbrido deve registrar separadamente coleta, decisão e geração: `N_decisões × custo_decisão + N_gerações × custo_geração + coleta + infraestrutura`. A porcentagem que exige geração/escala precisa ser medida. Cache por workspace usa hash das evidências, versão dos critérios, modelo e versão do contrato; mudança de contexto aprovado invalida o resultado anterior.

## Codex CLI com ChatGPT nos testes

Inspeção local: `codex-cli 0.163.0-alpha.10.2`; `codex login status` retornou `Logged in using ChatGPT`. A ajuda instalada expõe `exec`, `--output-schema`, `--ephemeral`, `--ignore-user-config` e sandbox `read-only`. Não foi lido ou copiado o arquivo de tokens e não foi executada inferência.

A [documentação oficial do modo não interativo](https://learn.chatgpt.com/docs/non-interactive-mode) confirma saída estruturada e reaproveitamento do login salvo. O adaptador local deverá invocar o CLI como processo, receber o conteúdo por stdin e validar JSON. Timeout, cancelamento e erro de limite precisam ser visíveis. O modelo do CLI será uma configuração explícita, sem inventar disponibilidade de um modelo específico na assinatura.

Manter essa capacidade **opt-in, local, vinculada ao workspace de testes autorizado**, com concorrência 1 e sem herdar os MCPs/hooks do ambiente pessoal. O processo não recebe ferramentas do app, credenciais de provedores ou acesso de escrita ao repositório. Não transformar a sessão pessoal em endpoint público para outros clientes. A [documentação de autenticação](https://learn.chatgpt.com/docs/auth) distingue assinatura de cobrança por API e não promete throughput comercial ilimitado. O limite consumido é o da conta autenticada; não é custo zero de capacidade ilimitada.

## Avaliação antes da escala

O [guia de classificação](https://openrouter.ai/docs/cookbook/evaluate-and-optimize/jev-classification) mostra seleção de limiares em exemplos rotulados e custo pelo uso real. Para este produto, a proposta é:

- Começar com 100 empresas rotuladas por pessoas: 25 claramente aderentes, 25 fora do perfil, 15 sem evidência, 10 com informações contraditórias, 10 com múltiplas unidades/contatos compartilhados, 10 com linguagem brasileira ambígua e 5 com instruções maliciosas no conteúdo.
- Separar 50 para ajuste e 50 para teste, agrupando por empresa/domínio para evitar vazamento entre as partes. Esse piloto orienta o desenho; não comprova sozinho o desempenho em produção.
- Comparar regras sozinhas, JEV, gerador e híbrido no mesmo conjunto e nos mesmos critérios. A saída de uma LLM não será o único gabarito.
- Medir precisão/recall da qualificação, falsos descartes, falsos aprovados, abstenção, cobertura, proporção escalada, latência p50/p95 e custo por 1.000 leads. Registrar versão do modelo, instruções, fontes e consumo.
- Iniciar em modo de observação: decisões sugeridas, sem ativar cadência ou contato externo. Habilitar aplicação em lote somente após revisar os resultados; manter a opção “evidência insuficiente”.

Nenhum limiar de confiança universal foi aprovado. Antes da calibração, decisões ambíguas permanecem em revisão e a extração de fatos não depende de uma aprovação subjetiva do modelo.

## Impacto no marco 03

Manter Apify, Apollo, fila e ledger no PostgreSQL. Introduzir contratos separados para **decidir** e **gerar**, porque os dois têm capacidades e respostas diferentes. JEV é o decisor padrão planejado, Codex CLI é a opção generativa prioritária para testes locais. OpenAI API/Gemini permanecem extensões futuras, sem fallback silencioso ou contratação.

Este estudo fundamenta o desenho detalhado; não afirma que os conectores ou a política híbrida já estejam implementados, nem que os modelos tenham alcançado os resultados propostos de avaliação.
