# Revisão final 06B.5

Data:28/10/2026. Base85009f4..2fe8447. Uma revisão independente em modo somente leitura; primeira tentativa interrompida por limite de uso, retomada no mesmo revisor. Não houve segunda revisão. Veredito inicial: não pronto para aceite. Critical:0; Important:8; Minor:0.

## Achados aceitos para a passagem de correção

1. Pausa ativa/contexto alterado impedem o encerramento do filho e a recuperação.
2. Falha/cancelamento terminal inicia outro job sem nova revisão.
3. Retomada repete lotes históricos já recuperados com sucesso.
4. Pendências parciais de pessoas e por módulo de qualificação não são expostas/recuperáveis.
5. Duplicata de outra lista bloqueia também empresas novas elegíveis.
6. SQL permite trocar o ator da jornada e impede pausa administrativa legítima.
7. Proposta falhada/cancelada/invalidada não pode ser substituída mantendo vínculo.
8. Contexto/política congelados são verificados em TypeScript, mas não na publicação SQL direta.

Regressões adicionadas antes das correções; resultados finais ainda pendentes.

## Pontos que o revisor não julgou

- Acurácia, disponibilidade e custos live Apify/LLM/JEV.
- Paridade integral de estados conectados/pagos não observados.
- Todas as57 imagens e interação completa de teclado/navegador (somente duas imagens vistas pelo revisor).
- Cleanup e saúde operacional atuais (documentos lidos, sem nova execução).
- Reexecução independente de suites/build/types.
- Varredura forense de segredos em binários/imagens/histórico completo.
- Envio real, trial, consumo comercial completo e limites OpenWA das integrações anteriores.
- Produção/carga/rollout/restore.
- Produto selecionável: DTO semproductId e escolha explícita no wizard existente, conforme ruling do executor.

Cada limite será decidido no ledger e preservado no aceite; nenhum foi convertido em evidência de sucesso.

## Resultado da passagem de correção

Os oito Important foram reproduzidos e corrigidos; nove regressões iniciais falharam antes da correção. O teste de duplicata forte foi adicionalmente verificado por mutação semântica do filtro de lista, que voltou a bloquear a jornada e passou após restauração. Casos adicionais cobrem cancelamento HTTP e adapter com falha determinística, contagem de chamadas, substituição concorrente, rejeição da opção obsoleta, um único rascunho e mudança de política central em SQL direto.346/346 unitários;402/402 integrações;19/19 focadas; build/tipos verdes.69capturas,12pós-revisão; nenhum efeito externo. Nenhuma segunda revisão. [Ledger com todas as decisões](evidence/06b5-prospecting-journey/execution-ledger.md).

Os nove itens fora do julgamento recebem rulings explícitos do executor. A verificação visual é limitada aos estados capturados; o runtime foi rechecado pelo executor; suites/build foram rerodadas por ele. Não há certificação forense global nem acurácia/entrega/carga live. Produto continua explícito no wizard, sem escolha implícita. O menor de navegação herdado06B.3 permanece para06F;0novos menores nesta revisão.
