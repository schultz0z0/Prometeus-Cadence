# 08A.5 — Seletores próprios

Foram migrados 113 seletores em 53 módulos. O botão e a lista de opções usam o mesmo componente de Execuções. O menu se posiciona em relação ao viewport e abre dentro de diálogos. O controle HTML oculto mantém o valor de formulário, a validação obrigatória e os eventos que os fluxos existentes consomem.

O teclado mantém o foco no combobox durante a navegação pelas opções. Enter confirma, Escape cancela e Tab confirma a opção destacada e avança o foco. O padrão de teclado segue a prática de referência. [W3C APG](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/)

## Prova local

A jornada falhou primeiro no Pipeline, onde o seletor original não abria um menu do app. A rodada após a implementação e a revisão passou em cinco etapas. Ela escolheu uma cadência no Pipeline, conferiu o menu no viewport de 320 px, exercitou Escape e Tab, alterou o canal em um diálogo e verificou foco e validação de lista obrigatória no gerador sem submeter o formulário. Resíduo zero.

As capturas locais em `output/playwright/visual-audit/selectors-pipeline-*.png` cobrem o Pipeline aberto e vazio. A referência guardada do Pipeline mostra os seletores fechados. As dimensões e cores dos controles fechados foram comparadas com essa captura. A geometria aberta é uma implementação local, sem captura equivalente da referência.

A medição completa foi consolidada com os demais ajustes locais. [Revisão](08a5-selectors-review.md) · [Relatório consolidado](08a6-local-closure.md)
