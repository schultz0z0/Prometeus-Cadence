# Avaliação de Scrapling e Browser Use

| Critério | Scrapling | Browser Use |
|---|---|---|
| Navegação | `AsyncDynamicSession` renderiza em Chromium e entrega o DOM. `page_setup` configura a página antes da navegação e `page_action` permite ações programadas. | `BrowserSession` oferece controle direto por CDP. No modo `Agent`, um modelo decide ações a partir do estado da página. |
| Cobertura de um domínio | Spiders, descoberta por links e sitemap, controle de concorrência e checkpoints da fila. | A sessão ou o histórico preserva estado de navegação ou ações. A fila de URLs, deduplicação e política de cobertura ficam com a aplicação. |
| Retomada | O checkpoint registra pendências e URLs vistas. O conteúdo confirmado precisa ser persistido separadamente. | Reabrir um navegador ou reproduzir ações não recupera o conteúdo confirmado de um domínio. Também exige persistência na aplicação. |
| Decisão | Serviço Python com dependências travadas. A fila e as evidências ficam com o Prometeus. | Controle direto avaliado. O modo agente e a opção hospedada acrescentam componentes que a coleta sistemática não exige. |

Fontes oficiais: [Scrapling — instalação](https://github.com/D4Vinci/Scrapling#installation), [fetchers](https://scrapling.readthedocs.io/en/latest/api-reference/fetchers.html), [sessões](https://github.com/D4Vinci/Scrapling/blob/main/docs/spiders/sessions.md), [checkpoints](https://github.com/D4Vinci/Scrapling/blob/main/docs/spiders/architecture.md), [Browser Use — sessão](https://github.com/browser-use/browser-use/blob/main/browser_use/browser/session.py) e [modos de integração](https://github.com/browser-use/browser-use/blob/main/skills/cloud/references/guides/tools-integration.md).

## Evidência e limites

- O experimento `tests/experiments/scrapling-browser.py` usou Scrapling 0.4.6, Playwright 1.58.0, o Chrome instalado e um servidor HTTP de teste em loopback. O DOM inserido por JavaScript ficou legível. O clique revelou o link esperado. Uma URL lenta excedeu o prazo e a mesma sessão leu a página de contato em requisição separada.
- A releitura por GET de um dataset de busca web da execução real de Curitiba retornou nove resultados orgânicos. Nove links foram normalizados e dois ficaram como candidatos após a triagem de domínio. Essa triagem ainda exige confirmação de identidade. A releitura não iniciou outro Actor.
- A revisão independente confirmou as asserções de DOM, clique e timeout. Faltam testes de navegação pelo link, paginação completa, liberação de recursos após timeout, retomada persistida, segurança de rede e isolamento entre sessões. O Browser Use foi avaliado pela documentação e código-fonte.

O `setup-agent` não estava disponível. A análise usou as fontes oficiais e o código do Prometeus. O build em execução ainda é o anterior.
