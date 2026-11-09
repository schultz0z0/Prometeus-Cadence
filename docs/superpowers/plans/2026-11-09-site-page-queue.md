# 06B.6b — Fila de coleta de sites

1. Exercitar em Postgres efêmero a retomada antes e depois do commit, cancelamento e isolamento.
2. Persistir uma entrada por URL, vinculada ao lease da execução. Gravar resultado e expansão da fila na mesma transação.
3. Ler robots.txt, sitemaps e páginas públicas no domínio permitido, com espera progressiva e indicação de cobertura parcial.
4. Validar o contrato da fila em isolamento. A entrada normal do Gerador e a troca de provedor serão verificadas no 06B.6c e no 06B.6d.
