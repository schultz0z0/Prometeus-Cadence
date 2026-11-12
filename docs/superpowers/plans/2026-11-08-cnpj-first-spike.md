# Prova controlada de prospecção com CNPJ primeiro

> **Histórico.** Superado em 09/11/2026 pelo [06B.7 — Prospecção em etapas](2026-11-09-prometeus-cadence-06b7-prospeccao-em-etapas.md). A jornada integrada saiu do fluxo padrão e dos critérios de lançamento. Não executar como plano vigente.

1. Reproduzir o cruzamento em memória com cadastro, Maps e site fictícios. Exigir CNPJ válido e ativo, mesmo município e UF, nome compatível e endereço corroborado. Com CNPJ publicado no site, aceitar telefone correspondente quando não houver conflito de endereço. Rejeitar homônimo, CNPJ divergente e associação ambígua. Telefone compartilhado sem endereço confirmado fica pendente.
2. Reaproveitar a leitura dos resultados Maps de Campinas e as páginas já registradas. Usar GET, sem novos Actors. Manter cadastros simulados somente em memória e registrar apenas contagens. Comparar quantos candidatos com site confirmado ficariam fora pela ausência do CNPJ nas páginas e quantos passariam com um cadastro corroborado.
3. Documentar a evidência e as limitações. A execução controlada não substitui a validação da cobertura dos CNAEs, da busca cadastral real, da precisão do cruzamento ou do custo por lead. Manter o protótipo fora da jornada operacional até essa decisão.
