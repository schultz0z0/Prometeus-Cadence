# Revisão dos ajustes locais do 08A.6

Revisão independente somente leitura. As fixtures observadas preservam publicações pausadas, inscrições paradas, canais desconectados e mensagens terminais no banco compartilhado. A abertura da sugestão de IA deixa a operação na tela anterior à revisão.

| Achado | Prova exigida |
|---|---|
| Tab podia repetir o primeiro controle ou sair cedo e ainda satisfazer a prova da varredura. | O teste da varredura registra a identidade de cada controle focado. A regressão do auditor apresentou oito controles com uma visita, falhou antes do ajuste e passou depois. |
| A leitura da fila não revalidava a sessão ativa na nova transação. | A integração troca o workspace ativo entre o relatório e a leitura da fila. Reproduziu a resposta indevida e confirmou 403 depois da nova checagem. |
| A caixa configurada em estado de atenção recebia o mesmo aviso da caixa sem configuração. | A jornada injeta uma resposta de leitura com caixa verificada em atenção e exige um aviso separado. A falta desse aviso foi reproduzida no build anterior. |
| A faixa Hoje excedia a largura disponível com a barra lateral a 768 px. O primeiro ajuste responsivo também era sobrescrito pela regra base. | A varredura registrou 103 px de overflow. O breakpoint de duas colunas foi posicionado depois da regra base para medir novamente o mesmo viewport. |
| O formulário de busca da caixa de e-mail já tinha contorno, mas a varredura verificava só o controle e seu rótulo. | A medição considera o contorno no formulário quando o controle de fato recebe foco por teclado. |
| O build anterior não exibia o cartão informativo em Primeiros passos. | A jornada espera o cartão e abre a Central de Ajuda em desktop e celular, com retorno do foco ao botão. |
