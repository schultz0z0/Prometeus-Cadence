# 06B.3 — Investigação da empresa e redes

Data: 27/10/2026. Implementação própria do contrato aprovado; revisão independente final em andamento. Não é aceite de paridade integral nem de produção pública.

## Entrega

- Gerador MAPS/WEB: ação para investigar empresas de uma lista existente, sem mudar o formulário principal da busca.
- Detalhe do contato: investigação em popup, seleção de fontes públicas e limite de páginas, revisão antes da execução e acesso ao histórico.
- Execução: progresso persistente, empresas selecionáveis, fatos por campo com URL, trecho literal, data e hash; resultado parcial preservado. Aplicação requer seleção explícita e outra revisão.
- Isolamento por workspace, papel atual, origem HTTP, lease/fence, revisão da fonte e idempotência no servidor/banco. Mudança de cadastro/configuração ou revogação durante coleta impede publicar fatos recebidos sob a autoridade anterior.
- Até 500 empresas por rodada, 10 páginas/empresa, 50 fatos/empresa; um contato por turno do worker e consulta de fatos de uma empresa por vez. Usa fila, receipts, quota e eventos existentes.
- Reutiliza perfis WEB/CNPJ centrais verificados e extrator de HTML público com DNS fixado/revalidação de redirects. Nenhum Actor arbitrário é recebido do cliente. LLM/Apify continuam administrados pela plataforma.

## Evidência funcional

| Caso | Resultado observado |
|---|---|
| Prepare e confirmação repetida | Prepare não coleta; uma confirmação idempotente cria um job |
| Domínio e perfil social divergentes | Não são convertidos silenciosamente em fatos aplicáveis |
| Empresa sem site | Fonte WEB habilitada é consultada; identidade ainda não comprovada continua em revisão |
| Falha em rede social/cadastro | Fatos do site preservados em `partial` |
| Checkpoint de lote | Um contato/turno; o contato já concluído não é coletado novamente |
| Aplicação | Apenas campos selecionados, uma transação, replay sem duplicação; edição concorrente impede sobrescrita |
| Revogação/configuração/cancelamento durante I/O | Zero fatos publicados; receipt técnico preservado; cancelamento não dispara outra coleta |
| API e SQL diretos | Anônimo, viewer, origem indevida, ID de outro workspace e escrita de fatos pela aplicação recusados |
| SSRF | Proteções existentes de DNS público e redirects mantidas; a suíte completa exercita localhost, redes privadas e rebinding |
| Browser | Seleção → revisão → aplicação → reload manteve um campo atualizado; erro 503 simulado preservou limite e fontes do rascunho |

Verificações executadas antes da revisão final: 317/317 unitários; 332/332 integrações na execução completa, seguida de 13/13 focados incluindo cobertura adicional do fallback sem site; build, TypeScript e `git diff --check` aprovados. Testes usam banco efêmero `_test`; não usam saldo Apify/LLM real. A cobertura adicional sem site passou sobre o serviço já existente, sem exigir outra alteração.

## UI/UX e referência

Manifesto e capturas mascaradas em [evidências](evidence/06b3-company-research/manifest.json). Foram conferidos gerador MAPS/WEB, contatos, detalhe, popup, revisão e execução em 1920×855, 390×844 e 320×844. São 21 capturas de layout e 6 da jornada de aplicação/erro/recuperação; nenhum overflow horizontal ou erro de JavaScript nos estados medidos. O foco da troca para revisão foi corrigido e novamente medido dentro do diálogo nos três tamanhos; Escape fecha o popup.

Comparação histórica: [gerador desktop da referência](evidence/06b1/reference-1920-generator.png) e [mobile](evidence/06b1/reference-390-generator.png), acervo RES/REA já existente. A composição principal foi preservada. Permanecem diferenças anteriores de ícones, microcopy, branding e controles adicionais da implementação própria, além das divergências aprovadas (7 dias, créditos pré-pagos, OpenWA). A nova interação de investigação e os estados pagos da referência não foram observados; não se afirma uma réplica visual verificada desses estados. O conector Chrome retornou `Target closed`; nenhuma sessão da referência foi alterada. REA não tinha observações retidas nesta sessão; sua evidência histórica foi reaproveitada, sem atribuir novas capturas ao MCP.

## Fontes, custos e limites

HTML público de site e redes não exige uma chave por cliente. Redes podem bloquear acesso público; isso é exibido como cobertura parcial, sem contornar login/CAPTCHA. Novos Actors sociais/autenticados dependem de contrato de entrada/saída/build/custo e habilitação central. `setup-agent` não estava exposto na descoberta de ferramentas; nenhum recurso equivalente foi criado/instalado ou recomendado do zero. Reutilizados WEB/CNPJ, Playwright, REA e RES existentes.

Telefone publicado não significa WhatsApp ativo, consentimento ou contato pessoal de decisor. Pesquisa pessoal/identidade empresarial aprofundada pertence a 06B.4; encadeamento automático com proposta de cadência pertence a 06B.5. Não houve compra, envio externo, contratação ou piloto pago neste pacote. Homologação empírica das fontes/LLM é 06IA-H; carga, restore e implantação pública são 08B.

## Encerramento de QA e runtime

[Prova de limpeza](evidence/06b3-company-research/closure.json): dois contatos fictícios próprios removidos, sessão QA revogada, nenhuma execução QA ativa. Uma lista vazia e o histórico sintético terminal permanecem só na identidade QA dedicada por causa da FK do job; não houve alteração da conta do operador, assinatura, canais ou política central. A sessão QA recém-aberta não tinha workspace inicial; encerrou sem sessão ativa, em vez de selecionar um workspace arbitrário.

Migração 083 aplicada no banco local sem modificar migrações anteriores. Servidor localhost 3210 e seis lanes contínuas reiniciados ocultos; health 200, processos vivos e zero falhas na verificação realizada.

## Decisões de execução

1. Checkout original em branch dedicada, conforme execução nativa anterior; se houver trabalho concorrente, será necessário isolar antes de novas alterações.
2. Ledger/briefs em Node com escopo do plano no Windows, em lugar dos scripts Bash; recuperação pelos registros e commits se houver divergência.
3. Nenhum Actor novo sem O Setup disponível e contrato verificado; custo: cobertura social autenticada permanece explicitamente limitada.
4. `companyResearch` como modo explícito da fila de qualificação, sem segunda fila; custo: consumidores devem manter a discriminação do modo.
5. Consulta de uma empresa por vez e um contato por turno; custo: lotes grandes exigem mais turnos do scheduler, preservando resposta limitada e equidade.
6. Nova interação usa primitives medidas e registra estados não observados da referência; custo: evidência futura pode exigir alinhamento adicional.

Revisão independente e eventuais correções serão registradas abaixo antes do aceite final.
