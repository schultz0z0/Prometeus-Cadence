# 06B.6c — Revisão da Prospecção completa

Um agente em modo somente leitura identificou que a reconciliação de um lookup de Maps, dentro de uma geração CNPJ, usava o perfil raiz do CNPJ. A revisão independente terminou após esse achado por limite da plataforma.

A regressão reproduziu a rejeição do Actor válido. Depois de selecionar o perfil Maps, o teste ainda mostrou a jornada bloqueada com a operação reconciliada. O worker agora reaproveita o run da mesma execução quando o autor original reconcilia e a revisão continua válida. Uma jornada pausada ou com revisão alterada segue sujeita a nova revisão. A resolução administrativa preserva a identidade do autor da jornada.

A revisão local adicional verificou que indisponibilidade do Chromium não dispara as fontes pagas e que um timeout de página preserva a página já confirmada. A prova usa dados sintéticos no Postgres efêmero. [Medição](06b6c-registry-first-browser.md)
