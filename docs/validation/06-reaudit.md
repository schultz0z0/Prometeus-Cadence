# Marco06 — auditoria atualizada e correção do roteiro

Data:24/10/2026. Baseline do código inspecionado:`a63161f`. Branch:`codex/billing-06`. Esta entrega altera documentação; não implementa cobrança nem muda os canais conectados.

## Resultado

O roteiro anterior cobria as grandes áreas, mas era insuficiente para demonstrar paridade completa. A nova auditoria adiciona quatro marcos corretivos (06B–06E), separa LinkedIn, SDR, integrações e descoberta de scoring (07A–07D) e distingue paridade visual de operação em produção (08A–08B).

Foram catalogadas29 áreas,84 evidências,18 regras de interface/oferta,7 famílias de telas,6 jornadas e3 componentes reutilizáveis. A inspeção de26 arquivos locais distingue o que já funciona do que continua provisório. Evidências e matriz ficam em `docs/reverse-engineering/reaudit-2026-10-24/`.

## Lacunas que justificam os novos marcos

| Área | Constatação | Destino |
|---|---|---|
| Comercial | Plano atual demonstrativo; uso de provedor não equivale a franquia comercial | 06A |
| Dados/qualificação | Enriquecimento de decisores só em prévia; validação de e-mail é DNS/formato, sem comprovar caixa; diferenças de filtros/módulos | 06B |
| Dashboard/relatórios | Há valores fixos, curva sintética, avisos antigos e performance simplificada | 06C |
| Notificações | Preferências existem; entrega, agrupamento e resumos recorrentes ainda precisam ser ligados | 06C |
| Canais/cadências | Adaptadores reais existem; falta fechar matriz de estados e registrar ida/volta real autorizada onde pendente | 06D |
| Segurança/dados | Sessões e isolamento existem; TOTP, retenção de corpos e mesclagem ainda diferem | 06E |
| LinkedIn/SDR | Apresentações locais não equivalem às jornadas operacionais observadas/ofertadas | 07A/07B |
| Integrações | CRM/Sheets/MCP/webhooks precisam sair de telas provisórias para contratos próprios | 07C |
| Scoring/Hot Now | Guia público usa planos antigos; não foi confirmado como oferta atual nesta conta | Descoberta07D |
| Visual | Referência usa Exo2 nos títulos; local usa Sora. Medidas e estados precisam comparação sistemática | 08A |

As evidências locais estão no manifesto EV-082; observações correspondentes aparecem na matriz de paridade. O compartilhamento do contexto `useDemo` no modo autenticado não significa que todos os dados sejam simulados: o repositório real é injetado pelo WorkspaceProvider.

## Catálogo comercial observado

Essential R$397/mês e Pro R$897/mês; anual20% abaixo do equivalente mensal. Franquias, caixas, números, assentos, créditos e adicionais foram registrados com evidência. Adicionais da referência são recorrentes. Nossa decisão continua mensalidade com pacotes de consumo pré-pagos; não confundir crédito consumível com capacidade recorrente.

## Limites da conclusão

Foi uma auditoria de observação, com navegação e formulários descartados. Não foram iniciados trial, compra, checkout, convite, conexão, extração ou envio na referência. SDR operacional exige Pro; demais estados conectados precisam ambiente próprio. A análise REA é estática e parcial (4 de36 arquivos selecionados); candidatos de endpoint não provam backend nem foram chamados diretamente.

O dashboard da referência apresenta10 qualificados em um indicador e11 na distribuição. A discrepância foi registrada como pergunta, não copiada como regra correta. Guias públicos antigos e candidatos Asaas também permanecem como descoberta, sem inclusão automática na implementação Stripe.

## Verificação

Contatos permaneceram com20 linhas visíveis e nenhuma seleção; automações4 de4 e nenhum objeto chamado `[RE] Audit preview`; trial/cobrança sem alteração. Nenhuma linha aberta no ledger de mudanças. Capturas de produção foram mascaradas; imagens foram recortadas para excluir identificação da conta.

Validação de IDs, referências, links, cobertura, índice e ledger pelo verificador RES com adaptação temporária de separadores Windows. O original comparava caminhos com barras POSIX e retornava falsos erros de IDs. O código instalado da skill não foi modificado. Não foram repetidos testes de produto porque nenhuma linha de produto foi alterada.

Próximo: desenho e implementação06A com Stripe em teste, catálogo próprio, concessões por evento autenticado e quota central no servidor. Ainda não há checkout real implementado nesta entrega.
