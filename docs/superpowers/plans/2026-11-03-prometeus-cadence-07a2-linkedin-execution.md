# 07A.2 — Campanhas, convites e aceites LinkedIn: plano de execução

03/11/2026. Executa o [plano de tarefas](2026-10-27-prometeus-cadence-07a2-linkedin-campaigns.md) sobre a conexão do 07A.1. A Unipile fica simulada nos testes; nenhum convite real sai sem contrato, chave, conta de teste e atestado da plataforma.

## Unipile (documentação pública, SRC-011 a SRC-013)

- **Busca clássica de pessoas:** `POST /api/v1/linkedin/search?account_id=` com `{api:"classic",category:"people",keywords,location:[ids],industry:[ids],network_distance:[2,3],advanced_keywords:{title}}` ou `{url}`. Devolve `items[]` (`id` = provider_id, `name`, `headline`, `location`, `network_distance`, `pending_invitation`), `paging.total_count` e `cursor`.
- **IDs dos filtros:** localização e setor exigem IDs, obtidos em `GET /api/v1/linkedin/search/parameters?type=LOCATION|INDUSTRY&keywords=`.
- **Engajamento em post:** `GET /api/v1/posts/{id}` traz o `social_id`, e `GET /api/v1/posts/{social_id}/reactions` e `/comments` trazem os autores.
- **Convite:** `POST /api/v1/users/invite {provider_id,account_id,message}`. A retirada é `DELETE /api/v1/users/invite/sent/{invitation_id}`.
- **Aceite:** `GET /api/v1/users/relations?account_id=` traz as relações mais recentes primeiro. A Unipile recomenda poucas consultas por dia.
- **Perfil (enriquecimento no aceite):** `GET /api/v1/users/{provider_id}?account_id=`, com `contact_info` quando a pessoa expõe.

## Desenho

- **Rascunho salvo** com revisão. Todos os controles do editor (EV-241) ficam no rascunho.
- **Pré-requisitos de ativação** (bloqueios exibidos na revisão):
  - conta pronta;
  - capacidades `audience`, `invite` e `acceptance`;
  - aquecimento só com `profileVisit` e `like`;
  - triagem de decisor indisponível (depende de IA, fica para depois).
- **Explorar:** chamada real, sem custo e sem gravar nada. Um filtro que não chega ao fornecedor (localização ou setor sem ID, link que não é de busca, post sem id) dá 422 antes de qualquer chamada.
- **Ativar:** congela a revisão e cria a lista de aceites (e a de não aceites, se pedida).
- **Coleta:** o worker coleta o público em páginas. Ignora quem já é conexão de 1º grau e quem tem convite pendente. Teto de 500 pessoas por campanha.
- **Convites:** o worker envia um por vez por conta, com trava por conta:
  - teto de 12 por dia por conta, somando campanhas, e o limite diário de cada campanha;
  - espaçamento mínimo de 20 min;
  - só em dias úteis, das 9h às 18h no horário de Brasília;
  - um convite por pessoa por conta (`linkedin_invite_operation` única);
  - a nota é preenchida só com dados do perfil, e falta de dado pula a pessoa;
  - antes do envio, confere de novo a campanha ativa, a conta pronta e a trava.
- **Desfechos do envio:**
  - 422: falha;
  - 429: devolve à fila e pausa a conta até o dia seguinte;
  - rede, tempo esgotado ou 5xx: "incerto", sem reenvio.
- **Aceite:** consulta as relações e faz o casamento pelo provider_id:
  - grava o aceite, um lead na lista de aceites e um evento, uma única vez;
  - o enriquecimento, se ligado, usa só o que o perfil expõe.
- **Não aceite:** a retirada acontece depois de N dias. O lead vai para a lista de não aceites, se configurada, sem resposta.
- **Pausar, retomar e cancelar:** um envio já reservado é devolvido no reteste antes da chamada.

## Fora do escopo

- **IA:** "Montar filtros com IA" e "trecho da IA" continuam indisponíveis, com aviso.
- **Triagem de decisor e aquecimento:** ficam bloqueados com motivo.
- **Cobrança por conta conectada:** fora deste pacote.
- **Pessoas, pipeline e mensagens:** 07A.3.
