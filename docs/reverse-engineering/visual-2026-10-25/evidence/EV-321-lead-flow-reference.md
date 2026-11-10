# EV-321 — Gerador, Qualificador e Enriquecedor na referência

Em 09/11/2026, a sessão existente do CadenceFlow no Chrome foi observada em modo L4. A aba voltou à tela inicial desta leitura, o Qualificador. A exploração se limitou à navegação entre telas.

- **Gerador.** A página apresenta uma fonte por rodada, lista de destino e início de geração. As fontes exibidas foram Google Maps, Busca na web, Base CNPJ e Apollo com chave própria. A descrição indica que a lista pode seguir para qualificação. A superfície observada não apresentou a ação Prospecção completa. [Captura histórica do Gerador](../../reaudit-2026-10-24/evidence/EV%2D024-lead-generator.txt)
- **Qualificador.** A página trabalha uma lista existente. A evidência histórica com lista selecionada mostra módulos de descoberta de site, contatos, extração profunda, consulta cadastral pelo CNPJ existente, resumo e avaliação por IA. [Módulos observados](../../reaudit-2026-10-24/evidence/EV%2D029-qualification-options.txt)
- **Enriquecedor.** A página anuncia o enriquecimento de decisores. A regra visível exige lead qualificado, com CNPJ e ainda não enriquecido. O resultado anunciado é uma lista de pessoas. O provedor e a efetividade da entrega de contatos permanecem desconhecidos nesta observação. [Captura histórica do Enriquecedor](../../reaudit-2026-10-24/evidence/EV%2D027-lead-enrichment.txt)

O REA analisou estaticamente dois arquivos JavaScript do acervo local `cadenceflow-audit-assets`, com 34 arquivos fora do recorte. Evidência `ev_7b8f974a6a0c145ff3f92f20d2bfaf04c19cf12b5eab5789d7a338c73823b3b0`. A confirmação dos fluxos e da elegibilidade vem da interface. A análise estática deixa fora o comportamento do servidor, a configuração de fornecedores e a execução de buscas.
