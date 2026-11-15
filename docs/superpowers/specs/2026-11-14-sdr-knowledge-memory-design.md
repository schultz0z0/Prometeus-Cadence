# Agente SDR: base de conhecimento da empresa, busca agêntica e memória longa

Data: 14/11/2026, revisado em 15/11/2026. Pedido do operador. Status: aprovado; a revisão de 15/11 torna a base da empresa compartilhada entre agentes.

## Intenção

Empresas sérias querem que o Agente SDR conheça o comercial delas além do contexto aprovado e do FAQ: método de vendas, script do vendedor, tabela de preços, detalhes de produtos e serviços, estilo de texto, regras de negócio. Isso vem em documentos, às vezes vários e grandes. Hoje o SDR só recebe até 50 itens curtos (FAQ/nota, 4.000 caracteres cada) inteiros no prompt e lembra só as últimas 20 mensagens. O objetivo é o SDR responder com o conhecimento real da empresa, citando de onde tirou, e lembrar a conversa inteira. Quem não quiser não usa: o agente continua funcionando só com a base direta.

Este é o último bloco de melhorias do Agente SDR antes de seguir com as demais homologações.

## Metas

1. **Duas bases de conhecimento:**
   - **Base direta** (existe): FAQ e notas aprovadas, inteiras no prompt. Sem mudança de comportamento.
   - **Base da empresa** (nova): documentos enviados pela empresa, quebrados em trechos com embeddings, buscados por relevância a cada resposta.
2. **Busca agêntica com limite:** a IA decide o que buscar, pode buscar uma segunda vez, responde citando os trechos.
3. **Memória longa da conversa:** resumo atualizado a cada turno + fatos do lead, além das 20 últimas mensagens.
4. **Isolamento total por workspace**, no mesmo padrão de RLS forçado do resto do app.
5. **Fontes visíveis na revisão:** quem aprova o rascunho vê de quais documentos a resposta saiu.

## Fora do escopo (não-metas)

- LangGraph ou qualquer framework de agentes (decisão do operador em 14/11/2026, após pesquisa).
- Imagem, áudio e vídeo como fonte (Gemini Embedding 2 aceita; fica para uma etapa 2).
- Importar de site, Google Drive ou Notion (etapa 2; v1 é upload de arquivo).
- Ligar a base da empresa nos outros agentes (prospecção, LinkedIn, assistente): a base é do workspace e cada agente escolhe o que usa, mas nesta fase só o SDR consulta. Os demais entram em etapas próprias, com testes.
- Responder sem aprovação: continua travado até o piloto supervisionado, como hoje.
- Separar formalmente "um agente por setor" (perfil, modelo e custo por setor): aprovado como direção, desenho próprio depois.

## Anti-metas (falharia mesmo funcionando)

- Um workspace conseguir ler trecho, documento, resumo ou fato de outro, por qualquer caminho (RLS, worker, busca, log).
- O agente afirmar preço, prazo, desconto ou condição que não esteja literalmente num trecho aprovado citado.
- Conteúdo de documento ser tratado como instrução (documento é dado; injeção de prompt num PDF não muda regras).
- Documento de cliente ir para a cota gratuita do Gemini (os termos permitem uso pelo Google).
- O rascunho demorar tanto que a conversa esfrie: a busca tem teto de passos e de tempo.

## Restrições

- Postgres é a única base de dados. O banco atual (`postgres:18`) **não tem `pgvector`**; passa para a imagem oficial `pgvector/pgvector` da mesma versão maior 18, mesmo volume. A hospedagem de produção precisa oferecer `pgvector` (requisito de deploy registrado).
- Embeddings sempre no **Gemini da plataforma**, modelo `gemini-embedding-2` (confirmar o id exato no build; existiu `gemini-embedding-2-preview`), **1536 dimensões** (o índice HNSW do `pgvector` aceita até 2.000 no tipo `vector`). A chave da plataforma precisa estar em projeto Google **com faturamento ativo** (fora da cota gratuita). Preço de referência: ~US$ 0,20 por milhão de tokens de texto; confirmar na página oficial.
- A resposta do SDR continua pela camada de IA central (`runConventionalJson`, rota e chaves do workspace), formato estrito validado.
- O agente SDR é recurso Pro; a base da empresa também.
- Fidelidade ao CadenceFlow: a referência só tem FAQ/notas com "Aprovar". A base de documentos, a memória longa e as fontes na revisão são **divergência escolhida pelo operador** e devem ser registradas em `AGENTS.md` junto das outras. A seção existente de FAQ/notas mantém o visual atual.

## Abordagens consideradas

| | Como | Troca | Decisão |
|---|---|---|---|
| **A** | Texto extraído no nosso worker, trechos com embeddings Gemini em `pgvector`, busca híbrida (vetor + texto), laço de busca escrito no worker | Mais código nosso; controle total, isolamento por RLS, custo baixo | **Escolhida** |
| B | Igual ao A, mas mandando o arquivo inteiro ao embedding multimodal | Ainda precisa do texto para a resposta; mais custo e complexidade | Etapa 2 (imagem/áudio) |
| C | File Search gerenciado do Google | Documentos fora do nosso banco, isolamento e dados com o fornecedor | Descartada |
| — | LangGraph para orquestrar | Não entrega memória nem RAG; checkpointer sem coluna de empresa (fora do RLS); falhas abertas em interrupts com Postgres no JS | Descartada pelo operador |

## Base da empresa, compartilhada (revisão de 15/11/2026)

Decisão do operador: a base é **da empresa (workspace)**, não do SDR. Ela mora em Configurações, ao lado de "Contexto de IA", como **"Base de conhecimento da empresa"**: a empresa sobe, revisa, aprova e remove documentos uma vez. Cada agente escolhe se usa e quais documentos usa; nesta fase só o Agente SDR consulta. Para o SDR, o conhecimento soma três camadas: o **Contexto de IA** aprovado (formulário), os **trechos da base da empresa** buscados por relevância e a **base direta do agente** (FAQ e notas).

O processamento dos documentos (extração, trechos, embeddings) é um serviço da plataforma por workspace, fora de qualquer agente; só a busca no momento da resposta pertence ao agente que consulta.

Ajustes vindos da pesquisa sobre RAG agêntico em produção:
- **Busca adaptativa:** mensagem curta ou só conversacional não dispara busca (o planejamento devolve zero consultas); a maioria das mensagens de WhatsApp cai nesse caminho barato.
- **Filtrar antes, não depois:** o índice HNSW do `pgvector` filtra depois de achar vizinhos e pode devolver menos trechos que o pedido quando há filtro por workspace e documento. A busca liga `hnsw.iterative_scan = relaxed_order` (pgvector 0.8 ou mais novo) na transação e confere a quantidade devolvida em teste.
- **Checagem de fundamentação:** a validação de valores contra trechos citados é a checagem barata e determinística; um juiz de IA extra fica fora por causa do teto de 3 chamadas.
- **Envenenamento da base:** só owner/admin enviam, e todo documento passa por aprovação com prévia antes de qualquer agente usar.

## Desenho

### 1. Documentos (ciclo de vida)

Fluxo: **enviado → processando → pronto (aguarda aprovação) → aprovado**, com **falhou** e **arquivado**. Só documento aprovado é buscado. Editar = enviar nova versão: a anterior continua valendo até a nova ser aprovada, e aí é substituída (os trechos antigos saem).

- Tipos v1: PDF, DOCX, TXT, MD, CSV, XLSX.
- Limites por workspace (iniciais, ajustáveis em código): 50 documentos ativos, 10 MB por arquivo (limite atual do armazenamento de arquivos), 300 páginas por PDF, 20.000 trechos no total.
- Armazenamento do arquivo original: o `BlobStore` existente, por workspace.
- Extração de texto (no worker, nunca na requisição web):
  - PDF com texto: extração local. PDF sem texto (escaneado) ou com tabela que a extração local quebra: transcrição pelo Gemini (documento → texto/markdown preservando tabelas), pela rota de IA da plataforma, contando uso.
  - DOCX: biblioteca de conversão para texto. XLSX/CSV: cada aba vira tabela em texto, cabeçalho repetido em cada trecho.
  - Bibliotecas: o construtor escolhe, mantidas e sem binários nativos; nenhuma executa macro ou conteúdo ativo.
- Quebra em trechos: ~600 tokens com ~80 de sobreposição, respeitando títulos e linhas de tabela; cada trecho guarda documento, versão, página/aba e posição.
- Embeddings em lote, `task_type` de documento na ingestão e de consulta na busca (se o modelo distinguir).
- Excluir documento apaga trechos e arquivo (LGPD); a exclusão do workspace já existente precisa incluir as tabelas novas.

### 2. Banco

Tabelas novas no schema `app`, todas com `workspace_id`, **RLS forçado** e escrita só por funções `SECURITY DEFINER` que conferem workspace e papel, no padrão de `sdr_knowledge`:

- `knowledge_document`: título, tipo, tamanho, hash do conteúdo (evita duplicado), versão, estado, erro, quem enviou e aprovou, contagem de páginas e trechos.
- `knowledge_chunk`: documento, versão, ordem, página/aba, texto, `embedding vector(1536)`, `tsv tsvector` em português com `unaccent`.
- Índices: HNSW em `embedding` (cosseno), GIN em `tsv`, e índice por `(workspace_id, document_id)`.
- Fila de ingestão: reaproveita o padrão de jobs com reserva/lease do worker existente.
- A revisão ativada do agente guarda quais documentos ele usa (`documentIds`, como `knowledgeIds` hoje), validados como aprovados na ativação.

### 3. Busca agêntica (no turno do SDR)

Só roda se o agente tiver documentos escolhidos. Passos, todos no worker do SDR:

1. **Planejar:** uma chamada curta devolve 0 a 3 consultas de busca a partir da mensagem do lead, do resumo e dos fatos. Zero consultas = segue sem busca.
2. **Buscar:** cada consulta vira embedding; busca híbrida no workspace e só nos documentos do agente: top 20 por vetor + top 20 por texto, combinados por Reciprocal Rank Fusion; ficam os 8 melhores trechos, no máximo ~6.000 tokens.
3. **Responder:** a chamada atual do SDR recebe os trechos numerados e devolve, além do que já devolve, `citations` (ids dos trechos usados) e `needMore` (até 2 consultas novas).
4. **Segunda volta (opcional, uma só):** se `needMore` vier preenchido, busca de novo e repete o passo 3 uma vez. Nunca mais que isso.

Tetos: no máximo 3 chamadas de modelo + 2 rodadas de busca por turno, dentro do limite de 90 s que o turno já tem. O planejamento pode ser pulado quando a mensagem for curta e conversacional (o construtor define a regra, com teste).

Validação no servidor:
- Citação fora dos trechos recuperados é descartada.
- Valor monetário, percentual ou prazo na resposta que não aparece literalmente num trecho citado (ou no contexto/FAQ aprovados) marca o rascunho com alerta na revisão. Como toda resposta exige aprovação hoje, o alerta é o mecanismo; quando existir resposta automática, isso vira bloqueio.
- A regra do prompt muda de "não invente preços" para "só informe preços, prazos e condições que estejam nos trechos ou no contexto aprovado, e diga de onde tirou".

### 4. Memória longa

No estado da conversa (`sdr_thread_state`), dois campos novos, por conversa e por workspace:
- **Resumo:** até ~1.500 caracteres, atualizado pela própria chamada de resposta (campo novo no formato de saída, sem chamada extra). Cobre o que saiu da janela de 20 mensagens.
- **Fatos do lead:** até 20 fatos curtos (`chave`, `valor`, `mensagem de origem`). Um fato só é gravado se o id da mensagem de origem for uma mensagem do lead no histórico enviado; os campos do script continuam como hoje. Fato repetido atualiza, não duplica.

O prompt passa a receber: resumo + fatos + últimas 20 mensagens + trechos. O resumo e os fatos são dados, não instruções. Quando uma pessoa assume a conversa, a memória continua; apagar a conversa apaga a memória.

### 5. Telas

- Em **Configurações → Base de conhecimento da empresa** (página nova; owner/admin gerenciam, os demais papéis só leem): enviar arquivo, lista com estado (processando, pronto, aprovado, falhou + motivo), páginas/trechos, aprovar, nova versão, arquivar, excluir.
- No editor do agente SDR, a seção "Base de conhecimento" mantém **Perguntas e notas** (como hoje) e ganha **Documentos da empresa que este agente usa**: lista dos documentos aprovados com caixa de seleção e link para a página de Configurações.
- Antes de aprovar um documento, prévia dos primeiros trechos extraídos, para a empresa ver se a leitura saiu certa (principalmente tabelas).
- Na revisão do rascunho, sob o texto: **"Fontes"** com documento e página de cada trecho citado, e o alerta de valor sem fonte quando houver.
- Estados de falha e carregamento com o mesmo padrão visual do app.

### 6. Custo e uso

- Embeddings e transcrições entram no registro de uso de IA existente (`usage_ledger`), por workspace, para medir custo real.
- Cobrança ao cliente: nenhuma mudança na v1 (a resposta do SDR já é a unidade cobrada). Revisar depois do piloto com o custo medido.

### 7. Testes e homologação

- Integração: isolamento (workspace B não acha nada do A por busca, leitura direta ou função), ciclo de vida, substituição de versão, exclusão, limites, citação inválida descartada, alerta de valor sem fonte, segunda volta limitada, fato sem mensagem de origem descartado.
- Unidade: quebra em trechos (tabela, títulos), fusão de rankings, validação de saída.
- Homologação real: subir 3 documentos da Prometeus (ex.: tabela de serviços em XLSX, script comercial em DOCX, apresentação em PDF), conversar pelo WhatsApp e conferir respostas, fontes e memória numa conversa com mais de 20 mensagens.

## Decisões do operador

- Duas bases: direta (como hoje) + base da empresa com RAG agêntico e busca vetorial no banco.
- Embeddings fixos no Gemini (Gemini Embedding 2).
- Fluxo nativo, sem LangGraph.
- Isolamento por workspace, pensando em vários usuários e empresas.

## Decisões do desenho (podem ser corrigidas)

- Gemini na conta paga da plataforma, não na cota gratuita (privacidade dos documentos).
- 1536 dimensões; busca híbrida com RRF; 8 trechos; teto de 3 chamadas e 2 buscas.
- Tipos v1 e limites da seção 1; imagem/áudio, site e Drive para a etapa 2.
- Documento passa por aprovação com prévia, como o FAQ.
- Memória pela mesma chamada de resposta, sem custo extra.
- Alerta (não bloqueio) para valor sem fonte enquanto toda resposta exigir aprovação.

## Deixado para quem constrói

- Bibliotecas de extração e o limiar para cair na transcrição pelo Gemini.
- Regra exata para pular o passo de planejamento.
- Forma da fila de ingestão dentro do worker existente.
- Ajuste fino de tamanho de trecho e de `k` medido na homologação.
