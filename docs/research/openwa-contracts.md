# OpenWA protocol pin

Source: [rmyndharis/OpenWA](https://github.com/rmyndharis/OpenWA/tree/173916c83b41e622f849ecd380bf36486dfd8cdf), version 0.25.0, MIT. Checkout is the `third_party/openwa` Git submodule. Updating it requires a new protocol review and explicit commit.

All gateway requests use the configured private origin, `/api`, and `X-API-Key`. No client-provided origin or session is accepted. The administrative key creates sessions and scoped operational keys; operational keys have role OPERATOR and `allowedSessions:[sessionId]`.

| Operation | Wire contract at this pin |
| --- | --- |
| Create/find session | POST `/api/sessions` `{name,config?}`; GET `/api/sessions?name=<exact>&limit=1`. Name is unique, 3–50 alphanumeric/hyphen characters. |
| Start/read | POST `/api/sessions/:id/start`; GET `/api/sessions/:id`. Session status is lowercase, `engineLoaded` is a separate live Boolean. `phone` contains digits without `+`. |
| QR | GET `/api/sessions/:id/qr`, `{qrCode:'data:image/png;base64,…',status:'qr_ready'}`. Transient and never stored by Prometeus. |
| Logout | POST `/api/sessions/:id/logout`. Lifecycle commands must respect desired state and revision. |
| Webhook | POST `/api/sessions/:id/webhooks`, with callback URL, events and secret. Registered before engine start/QR. |
| Text | POST `/api/sessions/:id/messages/send-text`, `{chatId,text}`, stable `Idempotency-Key`. Response 201 `{messageId,timestamp}` uses WhatsApp raw ID and integral Unix seconds; it confirms acceptance, not delivery. |
| Read message | GET `/api/sessions/:id/messages`, filtered by `messageId`, or bounded cursor `after`. Stored `id` is gateway UUID; `waMessageId` is the remote receipt key. |

Session response source: `src/modules/session/dto/session-response.dto.ts`. Send response source: `src/modules/message/dto/send-message.dto.ts` (`MessageResponseDto`). Incoming events are emitted in `message-projector.service.ts`; session status in `session-status-broadcaster.ts`; restrictions in `session-engine-lifecycle.service.ts`.

Webhook envelope: `{event,sessionId,timestamp,idempotencyKey,deliveryId,data}`. Envelope timestamp is ISO, incoming message timestamp is Unix seconds. HMAC-SHA256 covers exact transmitted bytes, `X-OpenWA-Signature: sha256=<hex>`. Headers alone are not event identity. `message.received` has incoming `data.id`, `chatId`, `from`, `to`, `fromMe`, `body`, `type`, `timestamp`; ACK has `messageId,status,ack,chatId?`. `message.failed` duplicates failed ACK semantics and must deduplicate by message/state. `session.restriction` includes `active,kind,code,expiresAt`; restrictions pause automation, and lifting them does not silently unpause a reviewed cadence. Session events do not prove an inbound service window.

The idempotency store retains keys for 24 hours per session. In-progress/uncertain outcomes and transport loss are uncertain in Prometeus; expiration is never permission to send again. ACK can arrive before POST response; retain receipt evidence until association. Only signed, session-bound callbacks or authenticated fixed-origin REST reads are accepted as gateway evidence.

Fixtures are synthetic; the QR is a one-pixel PNG, not an authentication QR. No live account identifiers, credentials or session files are included.
