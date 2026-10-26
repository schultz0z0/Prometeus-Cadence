# 06B.1 — Contatos, importação e busca

Execução nativa autorizada pelo operador em26/10, dentro do roteiro aprovado de fechamento de paridade. Preservar7 dias de trial, consumo pré-pago e OpenWA. Esta entrega completa contratos existentes; não reconstrói filas, scheduler ou roteamento de modelos.

## Resultado

- Contatos: combinar filtros por texto/lista/status/contato/origem/UF/favorito/data/resumo e cadência realmente vinculada; consulta autenticada paginada e limitada, ordenação estável, seleção e ações existentes sem perder rascunhos. Filtros que dependem de módulos futuros continuam identificados como indisponíveis, sem resultados inventados.
- Importação: arquivo CSV/TXT/TSV e texto manual; aliases em português/inglês, nome/sobrenome, mapeamento dos21 campos canônicos observados (mais sobrenome auxiliar), campos personalizados por contato, prévia de erros/duplicados e destino. Confirmação atômica usa deduplicação por CNPJ/e-mail/telefone normalizados no escopo escolhido e cobra apenas novas linhas aceitas. Não mesclar empresas por domínio ou nome. Nenhuma lista criada durante prévia.
- Busca: campos compatíveis com os adaptadores conectados, filtros não suportados rejeitados sem descarte silencioso; busca CNPJ por CNAE ou CNPJ. Sugestão de nicho reutiliza a análise de público existente e suas quotas/custos. Aplicar uma hipótese só preenche o formulário; busca efetiva tem revisão própria e histórico/resultados persistidos.
- Interface: comparar referência autenticada em1920×855 e390×844, incluindo menus, importação/mapeamento/revisão e gerador. Sem escritas na referência, compras, envios ou ativação de trial. Estados bloqueados seguem não observados.

## Arquitetura e escolhas

Escolha: ampliar os contratos atuais, usando consultas de leitura limitadas para contatos, o comando transacional existente para importações e o job `audience_plan` para sugestões. Uma segunda fila de IA ou um novo importador paralelo duplicaria autorização, idempotência e quotas. Uma mudança só de CSS deixaria controles sem operação.

O snapshot de autoria permanece completo para compatibilidade; a leitura paginada não será anunciada como eliminação de todo custo do snapshot. Consistência de comandos continua otimista por revisão do workspace. A prévia de duplicação é informativa; o servidor recalcula sob lock antes de gravar. Não alterar nem excluir contatos preexistentes por deduplicação.

Campos importados adicionais são opcionais no payload existente e continuam dados informados, sem selo de e-mail válido/WhatsApp verificado. Enriquecimento real permanece06B.2, fusão06E.2 e telemetria de canal06D/06C.2.

## Evidência e aceite

Base observacional: EV-216/EV-233 da KB visual; rechecagem de26/10 confirmou12 categorias de filtro e16 campos na ajuda inicial; avançar um arquivo fictício sem confirmar mostrou21 campos canônicos e a opção de campo personalizado. Importação manual oferece chave=valor, separador vertical, vírgula ou nome. Backend próprio testado sem alegar identidade com backend privado da referência. Campos personalizados desta entrega ficam no payload do contato, não alteram um esquema global compartilhado.

## Orientação de produção reforçada pelo operador

Em26/10 o operador reiterou que decisões e validações devem considerar o produto público final. Não adicionar atalhos de autenticação, credenciais de teste no bundle ou permissões especiais de homologação. Consultas e comandos passam pelos mesmos limites e barreiras usados pelo produto. Sessões/fixtures de QA ficam isoladas e serão limpas/revogadas; operação prolongada, capacidade de produção e implantação permanecem no aceite08B, sem serem presumidas por testes locais.

Testes: parser/mapeamento/normalização/dedup, importação transacional e quota/replay/conflito/isolamento, paginação/filtros/ordenação/limites/autorização, hipótese de IA→rascunho sem confirmação de criação, busca→job→contatos com adaptador de teste. Build/TypeScript, regressão e comparação visual desktop/mobile após aplicação. Integrações externas pagas não serão chamadas automaticamente.
