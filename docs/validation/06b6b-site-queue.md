# 06B.6b — Validação local da fila de sites

Medição de 09/11/2026. A fila do Prometeus guarda uma linha por URL canônica, workspace, execução e site. O Postgres publica o resultado, com URL, status HTTP, texto, hash e horário, junto com as novas entradas. O próximo lease pode reclamar a URL que ficou em processamento. O lease anterior perde a autoridade para publicar, inclusive após cancelamento.

A coleta começa por robots.txt, lê o sitemap quando disponível e amplia a fila pelos links renderizados. Prioriza a página inicial e páginas de contato, apresentação e informações legais. Redirecionamentos de documento voltam à fila para verificar o destino antes da leitura. Timeouts, HTTP 429 e falhas temporárias de servidor têm até duas retentativas com espera progressiva. A cobertura registra pendências, bloqueios, falhas, ciclos e truncamento. O limite operacional é de 500 URLs por site, incluindo robots.txt e sitemaps. A coleta considera páginas públicas descobertas pelos links e sitemaps do domínio, incluindo a variante www. Autenticação, formulários, downloads e páginas sem caminho de descoberta estão fora da prova.

## Evidência

- Postgres efêmero, 5/5. Dois processos filhos foram encerrados, um após reclamar a URL antes de gravá-la e outro depois do commit. Um novo lease na mesma execução repetiu a primeira leitura e retomou o próximo link no segundo caso. O teste também verificou rollback da publicação e dos links, cancelamento, consulta SQL sob RLS, deduplicação, regras de robôs, timeout e ciclos.
- Docker com Chromium e rede externa desabilitada, 10/10. Os testes usaram respostas HTTP controladas para JavaScript, paginação, redirecionamentos, timeout, limite de links e isolamento.
- Prova do contrato entre o cliente TypeScript, o gateway local e o Chromium real. Em example.com, robots.txt respondeu 404 e a página principal respondeu 200 com texto renderizado. O contêiner e a rede do teste foram removidos. A primeira asserção de conteúdo usava um título que já não aparecia na página. A repetição usou um trecho do texto publicado.
- Suíte unitária do app, 460/460. A compilação webpack concluiu, mas build e typecheck pararam nos erros do protótipo de CNPJ primeiro em discovery-admission.ts, já presentes antes deste marco.
- Integração completa, 682 aprovados, 2 falhas e 5 testes reais de Stripe desabilitados. O protótipo de CNPJ primeiro entrou em reconciliação em vez de concluir. A outra falha foi a medição abaixo.
- O teste de latência de relatórios mediu 289 ms de p95 na suíte completa, acima dos 250 ms esperados. A repetição isolada passou em 13/13 com p95 de 127 ms.
- O verificador da base de conhecimento registrou apenas os quatro erros históricos de clone/barriers.md.
- O auditor registrou 8/138 no estado atual do checkout. As medições de UI anteriores estão desatualizadas frente ao código atual. Este marco validou o backend isolado, sem alteração de tela.

O 06B.6c conecta a fila à Prospecção completa. A migração 113f foi aplicada somente nos bancos efêmeros. A homologação da jornada completa, a substituição do crawler da Apify nos demais pontos de entrada e a prova de carga ficam nos marcos seguintes. As execuções deste marco não consumiram créditos da Apify.

[Especificação de robots.txt, RFC 9309](https://www.rfc-editor.org/rfc/rfc9309)
