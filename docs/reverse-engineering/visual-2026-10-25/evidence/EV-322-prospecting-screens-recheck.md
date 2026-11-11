# EV-322 — Gerador, Qualificador e Enriquecedor, rechecagem de texto e estrutura

Em 10/11/2026, a sessão existente do CadenceFlow no Chrome do operador foi observada em modo L4: só navegação e leitura do texto de `/leads/generator`, `/leads/qualifier` e `/leads/enrich`. Nenhum clique em ação, nenhuma captura salva com dados da conta. A janela estava com zoom do navegador (viewport efetivo de 2133 px), por isso a comparação foi de estrutura e texto, não de pixel.

- **Gerador.** Quatro fontes com descrição e "Traz:". Busca na web: "a IA monta a busca e filtra o que não é empresa"; Apollo descrito com pessoas por cargo e listas salvas, com selo "Conectar" sem chave. Campos: Lista de destino (Criar nova / Usar existente), Palavra-chave ou Nicho com "Sugerir com IA", Localização, Máximo de resultados. Rodapé: os leads entram sem qualificação e o Qualificador vem depois. Ação "Iniciar geração", sem etapa de revisão.
- **Qualificador.** Aviso "qualifica uma lista, uma vez", contadores de jobs e qualificados, botão Histórico, nota da forma avulsa e passo 1 "Selecionar Lista de Leads".
- **Enriquecedor.** Promessa "do CNPJ até o celular com WhatsApp do sócio administrador". Três contadores: créditos (com uso do mês), empresas elegíveis (qualificadas, com CNPJ) e já enriquecidas. Elegível = qualificado, com CNPJ e ainda não enriquecido. Ação por lista "Enriquecer". Três passos em "Como funciona" e a regra de crédito: 1 por empresa resolvida, sem consumo quando não há contato.

## Alinhado no Prometeus

"Máximo de resultados", o texto do rodapé do Gerador, a descrição da Busca na web (sem prometer IA na montagem da busca, que o Prometeus não faz) e o rótulo "Enriquecer" na ação por lista.

## Diferenças mantidas por decisão do operador ou por honestidade da oferta

- Revisão de consumo antes de iniciar a geração (créditos adicionais e franquias).
- Elegibilidade do Enriquecedor por CNPJ válido, sem exigir qualificação; sem contador "já enriquecidas".
- Apollo descrito só com empresas: o plano gratuito testado não libera busca de pessoas, e o Prometeus não importa listas salvas do Apollo.
- Base CNPJ sem a promessa de "120 milhões" e de filtro por porte, que a fonte conectada não oferece.
- Enriquecedor sem a promessa de celular com WhatsApp: com fontes públicas, os decisores sem contato publicado ficam registrados sem contato.
- Entrada "Investigar empresas da lista" no Gerador, capacidade própria do Prometeus.

Não testado: estados com lista selecionada, popups de revisão e de preview, telas em 390 px, e comparação de pixel em 1920×855 sem zoom.
