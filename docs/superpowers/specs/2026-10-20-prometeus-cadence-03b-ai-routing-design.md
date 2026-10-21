# Marco 03B — roteamento de IA e Codex local

20/10/2026. Desenho para revisão do usuário antes do marco 04. Execução nativa preservada. Base: `76af8ef` na main; implementação ainda não iniciada.

## Intenção e aceite

Uma LLM convencional deve executar sozinha todo o trabalho de IA já entregue: qualificação, justificativa apoiada nas fontes, resumo e segundo parecer quando aplicável. JEV é opcional e priorizado para decisões quando o modo selecionado o permite, mas nunca funciona como único provedor de IA. O usuário escolhe o roteamento nas configurações do workspace e quer testar agora com o Codex CLI autenticado por ChatGPT.

Buscas Maps/Web/CNPJ/Apollo e extração determinística continuam usando os contratos do marco 03. LLM não inventa resultados de busca nem substitui uma integração de dados sem credencial. Audiências, mensagens/cadências geradas e scheduler do marco 04 não entram nesta alteração.

## Abordagem escolhida

Recomendação: um contrato convencional com três adapters (Codex local, OpenAI API e Gemini API) e um roteador único sobre a fila/journal/evidências existentes. Assim o modo isolado e o híbrido têm as mesmas confirmações, persistência e contabilização.

Alternativas consideradas: liberar primeiro apenas o Codex e deixar APIs para outra alteração (menor entrega, mas posterga a escolha de provedor solicitada); adicionar condicionais/fallbacks diretamente no qualificador (menor alteração inicial, porém duplica regras de uso e retomada). Não instalar gateway, MCP, plugin, SDK de IA ou framework novo. Reaproveitar Node/fetch/Zod/PostgreSQL e os adapters existentes.

## Configurações do workspace

Nova página **Configurações → Provedores de IA**, `/settings/ai`, separada de **Contexto de IA**, que mantém a oferta e o público-alvo.

Campos editáveis por owner/admin:

- LLM convencional selecionada: **Codex CLI · ChatGPT local**, **OpenAI API** ou **Google Gemini API**; opção vazia representa ausência de conexão.
- Roteamento: **Automático** (padrão), **Somente LLM convencional**, **Híbrido obrigatório**.
- JEV habilitado/desabilitado para o workspace. Chave existente no servidor não força sua utilização quando esta opção estiver desabilitada.

Salvar exige botão explícito, validação no servidor, revisão esperada e idempotência por requestId. Persistir em `app.ai_policy` com RLS, revisão e auditoria, fora do snapshot demonstrativo. Operator pode visualizar o estado autorizado, mas não alterar provedor, modelo ou roteamento. Nenhuma alteração troca a rota de um job já confirmado silenciosamente.

Credenciais continuam apenas no servidor, configuradas localmente; não entram em payload, frontend, log ou Git. Modelos convencionais e executável são configuração do servidor. Esta entrega não cria cofre de chaves por cliente nem um OAuth próprio do SaaS.

## Matriz de roteamento

| Modo | JEV habilitado e configurado | LLM convencional pronta | Comportamento |
|---|---|---|---|
| Automático | Não | Sim | LLM convencional decide e gera. |
| Automático | Sim | Sim | JEV decide; LLM convencional gera e atende escalas selecionadas. |
| Somente LLM convencional | Qualquer | Sim | LLM convencional decide e gera; zero chamadas JEV. |
| Híbrido obrigatório | Sim | Sim | JEV decide e LLM convencional complementa. |
| Híbrido obrigatório | Não | Sim | Bloquear IA e explicar que JEV é obrigatório neste modo. |
| Qualquer | Qualquer | Não | Bloquear trabalho de IA; nunca usar JEV sozinho. |

“Desconectado” antes da confirmação significa desabilitado/ausente/sem configuração válida. No Automático, a revisão mostra claramente a rota efetiva escolhida. Um resultado incerto depois de um POST não significa desconexão e não inicia outro provedor: continua exigindo reconciliação. Falha definitiva durante um job é registrada e explicada; não há troca automática escondida dentro de um job cuja rota e orçamento foram confirmados. O usuário pode corrigir/desabilitar JEV e confirmar um novo job convencional.

Não trocar OpenAI, Gemini e Codex entre si automaticamente. O provedor escolhido é o utilizado; falha não autoriza consumo em outra conta.

## Conexão e diagnóstico

Exibir separadamente **configuração encontrada**, **autenticação local verificada** (quando Codex), **último teste de inferência** e **erro/limite**. Presença de chave não prova saldo nem sucesso.

Botão **Verificar Codex CLI** executa somente diagnóstico autorizado, sem inferência: binário absoluto, versão permitida e `login status`, com timeout/saída limitados e resposta sanitizada. Não lê, copia ou devolve o arquivo de OAuth. Se for necessário autenticar novamente, instruir o usuário a concluir o fluxo oficial no CLI/browser; não receber tokens pelo chat ou pela página.

Botão **Testar LLM convencional** prepara uma revisão explícita de uma chamada com evidência sintética identificada. Só a confirmação cria a lista/lead sintéticos, job e reserva, atomicamente. Reusar o pipeline de qualificação com módulo resumo e tarefa de teste identificada; não criar executor paralelo sem ledger. Execução limitada a um registro e uma inferência, sem aplicar proposta automaticamente. Não testar OpenAI/Gemini sem chave/configuração; nenhuma compra ou cadastro automático.

Persistir resultado do teste por workspace, provedor/modelo e fingerprint da configuração, associado ao job e à revisão da política. O estado **LLM pronta para híbrido** exige configuração elegível e teste convencional bem-sucedido nessa configuração; teste válido por 24 horas. Mudança de provedor/modelo/configuração ou teste posterior com falha invalida esse estado. A ausência do teste não impede uma execução convencional, mas impede iniciar JEV no híbrido até o teste passar. Isso verifica a conexão antes de gastar com JEV; não garante que quota/rede continuem disponíveis depois.

Antes de cada passo JEV, o worker revalida elegibilidade convencional e a validade do diagnóstico/teste, sem fazer inferência adicional. No Codex também verifica autenticação/versão local. Se perder a conexão obrigatória, parar com erro explícito, preservar resultados e não marcar o job completo. Atualizar status/teste e revisar uma nova execução se a política mudou.

## Contratos e persistência

Um contrato convencional recebe tarefa `qualify`, `summary` ou `second_opinion`, critérios aprovados e evidências limitadas. Os três adapters retornam JSON validado, provedor/modelo, IDs de evidência, uso conhecido e custo conhecido ou desconhecido. Não habilitar ferramentas, pesquisa autônoma ou chamadas MCP para obter fatos.

Decisão comum admite JEV e provedor convencional, preservando origem e semântica. Convencional retorna `fits`, `does_not_fit` ou `insufficient_evidence`, justificativa curta e fontes; não fabricar `confidence`, probabilidades ou critérios numéricos de JEV. Confiança desconhecida permanece `null`. Regras de revisão distinguem os contratos: a ausência de uma confiança numérica convencional não torna todo resultado pendente, mas evidência insuficiente sempre torna. Toda qualificação continua proposta, nunca aplicada automaticamente.

No modo convencional não pedir um segundo parecer ao mesmo modelo como se fosse verificação independente. Resumo separado só é chamado quando selecionado e permitido pela política `all`/`fits`. No híbrido, JEV permanece o decisor principal; segundo parecer textual não sobrescreve sua decisão por conta própria.

Revisão HMAC inclui política/revisão e rota efetiva. Job confirmado guarda provedor/modelo/modo, versões de contrato e fingerprint da configuração em checkpoint. Worker usa essa rota, cache separa provedor/modelo/contrato/workspace/critério/evidência. Mudança incompatível bloqueia novos passos com instrução de revisão, preservando journal e resultados. Jobs legados mantêm a semântica antiga; uma configuração nova não reinterpreta consumo passado nem libera JEV legado sem acompanhante pronto.

Estender unidades existentes com `openaiCalls` e `geminiCalls`, limites independentes por workspace/globais e tokens quando reportados. Manter `codexCalls`/`jevCalls`; a estimativa usa a rota real: sem JEV não reservar `jevCalls`; com JEV não cobrar uma decisão convencional que não será feita. Reservar resumo/escala somente quando aplicáveis. Custo ausente nunca vira zero. Migração aditiva atualiza políticas de unidade sem alterar checksums 001–011.

IDs das operações incluem a tarefa, evitando que uma mesma etapa cobre dois provedores. Chamada ambígua retém reserva e exige a reconciliação administrativa já existente, também para OpenAI/Gemini. Cancelamento, revogação de acesso, fencing e conflitos de aplicação conservam os contratos do marco 03.

## Adapters e execução local

- Codex usa `codex exec` e a autenticação salva do CLI; ampliar seu schema/prompt para qualificação. Manter versão verificada, ferramentas desabilitadas, isolamento temporário, limite 120s/1MiB, stdin, serialização PG e ambiente sem chaves dos outros provedores. Não usar endpoints privados de ChatGPT. Somente loopback/local e workspaces explicitamente autorizados; não expor esta sessão pessoal no SaaS público.
- OpenAI usa Responses API com JSON Schema estrito e sem ferramentas, chave somente em header e `store:false`; modelo explícito configurado, sem alias de “último” escolhido silenciosamente.
- Gemini usa API oficial `generateContent` com JSON estruturado, chave somente em header e modelo explícito. Validar o subconjunto de schema suportado e a resposta normalizada; não presumir que o envelope seja igual ao da OpenAI.

No reconhecimento de configuração, exigir suporte aos contratos da tarefa; erros de recusa, resposta incompleta, quota, JSON inválido, timeout e ausência de fonte são estados próprios, não classificação negativa.

## Validação e uso imediato

Testes RED→GREEN da matriz inteira, JEV sem acompanhante bloqueado antes de chamar a rede, ausência de `jevCalls` no modo convencional, isolamento de políticas entre workspaces, permissões e conflito/idempotência ao salvar. Testar teste de conexão expirado/fingerprint divergente, configuração ausente, conta/CLI inválido, quota, resultado incerto e mudança de política entre preparar/confirmar/executar. Testar qualificação convencional com confiança desconhecida e fontes válidas, abstenção sem evidência e ausência de geração extra não selecionada.

Integração PG cobre reservas consumidas uma vez, cache/rota distintos, revogação e aplicação confirmada com conflito humano. Browser percorre nova página, modos/bloqueios, revisão de teste e qualificação/resultado no modo convencional, incluindo mobile/console. Rodar regressões, typecheck e build.

Após aprovação e implementação, configurar `.env.local` com o binário existente, modelo acessível explicitamente escolhido, modo local e allowlist do workspace QA; budgets mínimos e sem habilitar Apify/Apollo. Fazer teste real de uma inferência sintética e um lote de um lead para qualificar/resumir (máximo três inferências no total), registrando uso, fontes, resultado e limite encontrado. Nenhum envio de mensagem. OpenAI/Gemini têm aceite contratual offline até haver credenciais; não declarar sucesso real sem chamada.

Diagnóstico já realizado em 20/10/2026: `codex-cli 0.163.0-alpha.10.2`, `login status` bem-sucedido com ChatGPT. Nenhuma inferência desta alteração executada; credenciais não foram lidas nem copiadas.

## Referências verificadas

- Código e validação do marco 03: `src/server/prospecting/`, `docs/validation/03-prospecting.md`.
- [OpenAI — autenticação Codex](https://learn.chatgpt.com/docs/auth): sessão ChatGPT e API key são mecanismos distintos; reusar o CLI local, sem transformar OAuth em API key.
- [OpenAI — execução não interativa](https://learn.chatgpt.com/docs/non-interactive-mode): `exec`, autenticação salva, JSON/schema e flags de isolamento.
- [OpenAI — saída estruturada](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses): contrato JSON Schema da Responses API.
- [Google — saída estruturada generateContent](https://ai.google.dev/gemini-api/docs/generate-content/structured-output?hl=en): contrato JSON e suas restrições próprias.

## Estado

Desenho escrito e conferido contra a solicitação, com opção de configuração incluída. Aguarda revisão do usuário; depois será escrito o plano de implementação. Método nativo já escolhido permanece válido.
