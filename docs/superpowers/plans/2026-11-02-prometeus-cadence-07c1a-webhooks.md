# 07C.1a — Webhooks de saída

Data: 02/11/2026. Primeiro pacote do [plano 07C.1](2026-10-27-prometeus-cadence-07c1-api-webhooks.md), dividido como o 06E e o 06F:

- **07C.1a (este):** webhooks de saída fiéis à página "Webhooks e API" da referência.
- **07C.1b:** API pública com tokens escopados (`/api/v1/leads`, `/api/v1/events`), revogação e rotação. A referência não mostra esta superfície.

## Referência

EV-260/261 (diálogo), EV-262/263 (página) e o componente cliente retido (`20ketoonyj8b5.js`, `/api/settings/webhooks`). A página tem:
- até 10 destinos, cada um com nome, URL, badges de eventos e listas, contagem de entregas e alerta de falhas seguidas;
- ações de ativar/pausar, histórico, editar e excluir;
- segredo gerado e mostrado uma vez, ou colado pela pessoa;
- botão de teste.

O diálogo traz nome, URL pública HTTPS ou HTTP, segredo, os eventos `lead.created`, `lead.qualified` e `lead.connected` (geral, e-mail e WhatsApp), os eventos do agente e o escopo de listas (todas ou específicas). O cabeçalho `X-Webhook-Signature` leva o HMAC SHA-256 do corpo.

Divergências decididas:
- **Eventos do agente:** aparecem desabilitados, com destino 07B, porque o Agente SDR não existe.
- **Chave OpenAI própria:** fica fora. A IA é central, por decisão do usuário.

## Contrato

- **Migração 095:**
  - `webhook_destination`, com segredo cifrado (AES-GCM do keyring de canais), revisão, falhas seguidas, último sucesso e estado de atenção;
  - `integration_event` e `integration_delivery`, com `UNIQUE(workspace_id,destination_id,event_id)`;
  - RLS por workspace, escrita só por funções `SECURITY DEFINER`.
- **Eventos gravados por trigger na transação do efeito:**
  - `lead.created`: INSERT em `app.lead`, exceto na restauração de fusão;
  - `lead.qualified`: a qualificação passa a `qualified`;
  - `lead.connected`: mensagem recebida numa conversa vinculada a lead, com `data.channel`.

  Commit abortado não gera evento. Só destinos ativos, com o evento e a lista assinados, recebem a entrega.
- **Serviço:**
  - `prepareWebhook`/`confirmWebhook` com revisão: valida o nome, a URL pública (DNS e IP na revisão) e os eventos, e respeita o limite de 10;
  - ativar/pausar, gerar segredo novo (mostrado uma vez), excluir, testar (evento `webhook.test` pela mesma fila) e reenviar falhas;
  - somente proprietário ou administrador.
- **Worker** no lane `notifications`:
  - lease por entrega; DNS e IP validados a cada tentativa, com conexão fixada no IP aprovado (contra rebinding); redirecionamento não é seguido;
  - timeout de 10 s e corpo de até 256 KiB;
  - HMAC `X-Webhook-Signature` do corpo, que inclui `sentAt` e `idempotencyKey`;
  - retentativas em 1 min/5 min/30 min/2 h/6 h até 24 h, só para 429, 5xx e rede; 429 respeita o `Retry-After` dentro de 24 h;
  - 401/403/410 colocam o destino em atenção e retêm as entregas seguintes, sem laço;
  - entrega pelo menos uma vez: o resultado incerto é registrado e retentado com o mesmo `idempotencyKey`.

## Testes

- **Unitário:** `webhookRetryAllowed`, agenda de retentativas, `Retry-After`, assinatura e esquema dos destinos.
- **Integração:**
  - commit abortado e evento reprocessado: 1 entrega lógica;
  - endereços privados e rebinding bloqueados antes do request;
  - 429/5xx/401 e limite de 24 h;
  - outro tenant não lê nem envia;
  - membro removido;
  - segredo mostrado uma vez e nunca devolvido;
  - contrato HTTP.
