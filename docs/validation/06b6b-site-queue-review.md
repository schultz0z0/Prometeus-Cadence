# 06B.6b — Revisão independente da fila de sites

A revisão foi feita em modo somente leitura por outro agente. Ela examinou migração, autoridade do worker, coleta de documentos e testes.

| Achado | Correção e prova |
|---|---|
| Um ciclo de redirecionamentos podia encerrar a fila sem texto e contar páginas como lidas. | Redirecionamentos ficam no histórico sem contar como documentos lidos. Um teste fecha um ciclo com duas URLs e exige cobertura parcial e zero documentos. |
| Uma resposta robots.txt com codificação incompatível podia ser interpretada como arquivo vazio. | O cliente só aceita texto UTF-8 válido ou gzip com limite de descompressão. O teste falhou antes da correção e passou depois. |
| O teste de isolamento verificava a API da fila, que já filtrava por execução. | O teste também usa SQL direto com o papel de worker. A consulta vê a linha no workspace original e vê zero no outro, mesmo com os dados do lease original. |

A retomada de produção e a revisão da experiência na interface pertencem ao 06B.6c. Consulte a [medição local](06b6b-site-queue.md).
