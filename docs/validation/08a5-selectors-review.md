# Revisão do 08A.5

Revisão independente somente leitura sobre a migração. O revisor conferiu os consumidores dos eventos, a validação de formulários, os controles desabilitados, foco e os seletores CSS migrados.

**Corrigido.** Ao destacar outra opção e pressionar Tab, o controle anterior descartava a escolha. A jornada falhou nesse passo e passou depois que Tab começou a confirmar a opção antes de mover o foco. Escape continua fechando com o valor anterior.

**Escopo do teste.** A jornada passou seleção por ponteiro e teclado e uma validação obrigatória real. O código conserva opções e controles desabilitados. A rodada não inclui prova de cada seletor com leitor de tela, listas longas em aparelhos físicos ou todos os formulários condicionais.
