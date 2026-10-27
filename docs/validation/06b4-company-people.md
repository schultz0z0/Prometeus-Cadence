# 06B.4 — Identidade empresarial e tomadores de decisão

27/10/2026. Implementação própria do contrato aprovado, no ambiente local/controlado. Revisão independente final ainda pendente nesta versão do relatório. Não é aceite de produção pública nem de paridade integral com estados inacessíveis do CadenceFlow.

## Entrega implementada

- Enriquecimento aceita empresas com ou sem CNPJ informado. Cruza site público, busca WEB e cadastro/QSA dos perfis centrais verificados; múltiplos CNPJs e filial divergente ficam em conflito.
- Empresa, sócio, gestor e contato têm evidências separadas. Gestor não precisa ser sócio; sócio sem telefone/e-mail permanece pessoa no histórico. Cargo explicitamente anterior fica incerto.
- E-mail/telefone só viram contato pessoal quando há atribuição literal à pessoa e vínculo empresarial sustentado. Telefone geral, e-mail genérico, CPF, idade, inferência de e-mail e suposta atividade de WhatsApp não são promovidos a contato pessoal.
- LLM tradicional extrai candidatos com o contexto privado da empresa usuária e pedido congelados. No modo híbrido, JEV avalia as evidências em uma operação própria. Instruções compartilhadas e contratos existentes reaproveitados; cliente não fornece chave Apify/LLM.
- Cache privado por workspace, base da empresa, contexto e contrato/modelo; fontes copiadas e referências revalidadas. Até 7 dias; cache prometido expirado não inicia consulta paga. Mesma resolução útil não debita crédito comercial outra vez.
- Revisão antes da consulta e outra antes de criar contatos na lista. Confirmação idempotente, origem HTTP, papel atual, workspace, revisão, fontes, contexto, lease e elegibilidade repetidos no servidor/banco.
- Modos existentes de enriquecimento e pesquisa empresarial preservados. Novo modo explícito `companyPeople` usa a mesma fila, journal, orçamento e reservas; um caso por turno. A indicação de enriquecido nas listas/detalhes usa proveniência protegida, não campos editáveis.

## Verificação pré-revisão

Domínio/cliente: 8/8 testes focados; 327/327 unitários completos. Serviço: 12/12 integrações próprias; compatibilidade com pesquisa e enriquecimento anteriores exercitada. Build e TypeScript aprovados. A segunda execução da suíte completa está em andamento; seu resultado final será registrado após a revisão.

Casos cobertos: homônimos/filiais; gestor e sócio sem contato; ausência/conflito; cache entre empresas equivalentes sem cruzar tenants; expiração e saldo zero; contexto/contato/fonte alterados; aplicação SQL direta; perda de membro ou elegibilidade durante I/O; cancelamento; resposta incerta e reconciliação sem repetir; worker sem capacidade para forjar proveniência de entrega; cópia de cache sobrevive à remoção da empresa original; HTTP anônimo/viewer/inválido/desatualizado; replay do cliente após perda de resposta; tradicional versus JEV.

A suíte completa detectou uma regressão na ordem do trigger comercial: `BEFORE` alcançava reserva nula antes da constraint do job inválido. `084a` restaura o `AFTER` original; teste antigo de planejamento passou novamente. `084b` restringe colunas de INSERT do worker e desvincula a origem de cache removida. Migrações aplicadas não foram reescritas.

## UI/UX

[Manifesto e capturas](evidence/06b4-company-people/manifest.json): 35 estados em 1920×855, 390×844 e 320×844, incluindo enriquecimento, preview, revisão da execução, contatos, detalhe, popup de investigação, resultado com pessoa sem contato, revisão de criação, identidade conflitante e LinkedIn/enrichment. Conferidos foco/Tab/Escape, scroll, atualização com falha preservando seleção, aplicação revisada e persistência após reload. Zero overflow horizontal, zero foco fora dos popups medidos e zero erro JavaScript nos estados capturados.

Comparação histórica com [enriquecimento desktop da referência](evidence/06b2/screens/reference-1920-enrichment.png) e acervo RES/REA de06B.2: estrutura principal mantida (título, três indicadores, lista e explicação lateral). Diferenças explícitas: dados/quantidade de linhas, branding e ícones anteriores, histórico em lugar de compra de recurso ainda não vendido, microcopy honesta sobre cobertura e empresas sem CNPJ, novo resultado próprio de identidade/pessoas. Backend, preview pago e resultados pessoais da referência não foram observados; não se declara réplica verificada desses estados. Nenhuma alteração na referência.

## QA, orçamento e limites

A quota diária local recusou uma confirmação de consulta, corretamente. Não aumentamos limites ou saldo para contornar esse bloqueio. Para a inspeção visual, duas empresas e três pessoas sintéticas foram inseridas apenas na QA dedicada, com banner explícito; execução/cobrança foram provadas separadamente pelo serviço real e adapters injetados em banco efêmero `_test`. No browser, criação revisada de um contato e reload foram reais.

[Encerramento de QA](evidence/06b4-company-people/closure.json): três contatos fictícios próprios removidos, todas as sessões da identidade QA revogadas, zero job ativo. Duas listas vazias e um histórico sintético terminal retidos na QA. Sem canais, mensagens externas, chamadas pagas ou mudanças na conta do operador/política central. Orçamento de produção preservado.

Nenhum Actor novo foi escolhido/instalado. `setup-agent` não estava exposto na descoberta; reutilizados perfis WEB/CNPJ, HTML público seguro, Playwright e acervo RES/REA existentes. Perfil social pode estar indisponível publicamente; contato pessoal ausente continua ausente. Piloto pago/medição de cobertura/acurácia pertence a06IA-H; integração oficial de engajamento LinkedIn a07A; implantação/carga pública a08B.

## Decisões de execução

1. Checkout original em branch dedicada para manter a execução nativa/runtime; trabalho concorrente exigirá isolamento.
2. Ledger/briefs Node no Windows em lugar do harness Bash; recuperação pelo Git se o registro divergir.
3. `companyPeople` explícito na fila existente em vez de combinar modos incompatíveis; consumidores futuros devem discriminá-lo.
4. Sem novo Actor sem acervo/contrato verificado; cobertura social autenticada permanece limitada.
5. Proveniência de entrega em `research_person_company` e ledger financeiro existentes; novos leitores devem consultar essa proveniência.
6. Cache completo de pessoas/fontes pelo contrato e base privada; mudanças de evidência/contrato exigem outra revisão.
7. QA visual sintética devido ao orçamento real esgotado; a validação de fornecedor pago continua pendente do piloto próprio.
8. Migrações complementares preservam checksums e semântica anterior dos triggers; ferramentas de release devem reconhecer os sufixos.
9. Listas vazias/histórico terminal retidos apenas na QA; limpeza histórica futura exige arquivamento explícito.

## Próximo pacote

Após o aceite efetivo deste pacote: **06D.1 — autoria, variantes, anexos e publicação**. Não iniciado por esta implementação.
