# OpenWA — estudo para integração ao Prometeus

Data: 23/10/2026. Estudo estático; nenhum número foi pareado e nenhum container OpenWA foi iniciado nesta fase.

## Fonte identificada

- Repositório solicitado: <https://github.com/rmyndharis/OpenWA>, e não outros projetos com nome OpenWA.
- Revisão examinada: `173916c83b41e622f849ecd380bf36486dfd8cdf`, de 21/10/2026; `package.json` declara versão `0.25.0`.
- Cópia de leitura: `.runtime/openwa-reference`, ignorada pelo Git do Prometeus. Não foram instaladas suas dependências nem executados seus scripts.
- [Licença MIT](https://github.com/rmyndharis/OpenWA/blob/173916c83b41e622f849ecd380bf36486dfd8cdf/LICENSE): preservar licença e atribuição na distribuição. A licença do código não equivale à aprovação do WhatsApp.

## Capacidades confirmadas no código

| Capacidade | Evidência na revisão fixada | Consequência |
| --- | --- | --- |
| Criar, iniciar, consultar, parar e deslogar sessão | `src/modules/session/session.controller.ts` | Backend do Prometeus pode provisionar uma sessão por conexão; usuário final não precisa de chave do gateway. |
| QR Code | `GET /api/sessions/:sessionId/qr`, `docs/06-api-specification.md` | Resposta contém `qrCode` em PNG data URL e `status`. Deve transitar apenas em resposta autenticada, sem cache ou logs. |
| Texto | `POST /api/sessions/:sessionId/messages/send-text`, `message.controller.ts` | Envio servidor-servidor com `X-API-Key`; corpo utiliza `chatId` e `text`. |
| Idempotência | `src/modules/message/idempotency/*`, documentação da API | `Idempotency-Key` por sessão, retido por 24 horas; repetição em andamento ou com resultado incerto é recusada. Não permite classificar timeout como falha comprovada. |
| Eventos | `src/modules/webhook/dto/webhook.dto.ts` | Existem `message.received`, `message.sent`, `message.ack`, `session.status`, `session.qr`. Precisamos validar seus payloads concretos antes do adaptador. |
| Assinatura | `src/modules/webhook/utils/deliver-once.ts` | `X-OpenWA-Signature: sha256=<hex>` é HMAC-SHA256 dos bytes exatos com segredo do webhook. Eventos sem assinatura não serão aceitos pelo Prometeus. |
| Limitação de chave | `session.controller.ts`, autenticação e `docs/28-multitenancy.md` | `allowedSessions` e papéis permitem limitar o acesso; criação de sessão exige chave sem restrição de sessões. Chave de provisionamento permanece só no servidor. |
| Persistência e reinício | Docker Compose, configuração e lifecycle | Sessões usam armazenamento persistente; `AUTO_START_SESSIONS` precisa ser configurado explicitamente. |
| Moderação de volume | `src/modules/message/send-pacing.config.ts` | Pacing vem desligado; a configuração padrão cresce até volumes inadequados ao nosso piloto. Fixaremos limites conservadores explicitamente. |

Os métodos acima são contratos examinados estaticamente, não sucesso comprovado em execução.

## Limites que afetam o desenho

1. **Sessões não equivalem a empresas isoladas.** `docs/28-multitenancy.md` identifica o estado atual como multi-session e descreve multitenancy completa como evolução. O Prometeus deve impor workspace, conexão, sessão e autorização em cada operação e no ingresso.
2. **Não há garantia contra banimento.** O README reconhece restrição, banimento, problemas de entrega inicial e impedimentos de pareamento. A comparação de risco entre motores é declaração do mantenedor; não é evidência independente de segurança de uma conta.
3. **Custo de infraestrutura existe.** O README estima cerca de 300–500 MB por sessão com `whatsapp-web.js`, contra menos RAM no Baileys. Não medimos esses números; capacidade real terá de ser observada no piloto.
4. **Sem acesso ao Docker do computador.** Os arquivos de implantação upstream também oferecem orquestração de infraestrutura via Docker socket proxy. O Prometeus não precisa desse recurso e não montará Docker socket nem habilitará essa administração.
5. **Callbacks locais exigem desenho de rede.** O servidor Next está em loopback no Windows. O callback OpenWA será entregue a um receiver na rede Docker, sem publicar o app completo. A exceção SSRF será apenas o hostname interno desse receiver; não desligaremos a proteção global.
6. **Clientes e versões upstream são dependências sensíveis.** Fixar a revisão e conservar o lockfile; não executar atualizações ou patches do WhatsApp automaticamente durante uma atualização do Prometeus.
7. **Credenciais de sessão têm alto valor.** Volumes, chaves, QR e backups precisam de proteção; não transportar cookies/sessões para o frontend nem registrar os dados de autenticação em evidências.

## Referência CadenceFlow

Evidência: captura fornecida pelo usuário em 23/10/2026 da rota `/settings/whatsapp`, arquivo original `codex-clipboard-bd6370a9-9295-4132-b51e-4aa9f7650648.png`. Cópia local em `docs/reverse-engineering/screenshots/2026-10-23-whatsapp-settings-reference.png`, ignorada pelo Git conforme a política existente de evidências.

- Dois caminhos visíveis: Meta oficial e número próprio.
- Número próprio apresenta conexão por QR Code e orientação de ritmo conservador.
- A referência menciona Z-API; o requisito do usuário substitui esse fornecedor por OpenWA.
- Alegações da referência sobre ausência de bloqueio não serão reproduzidas como garantia.

Não foi necessário abrir ou alterar a conta CadenceFlow para confirmar esses elementos da captura. A engenharia reversa orienta a experiência; o código do OpenWA é lido diretamente, pois está disponível.

## Decisão recebida

Usuário escolheu **OpenWA gerenciado pelo Prometeus no Docker, com QR Code dentro do app**. Autorizou clonar o projeto e integrá-lo ao sistema. A opção Meta será preservada; Twilio será retirado do fluxo novo. A conexão Meta de teste só será desligada após a implementação, preservando histórico.

## Ainda não testado

Build da imagem fixada; inicialização e consumo de memória; pareamento real; payloads reais de ACK e mensagens; recuperação após reinício; isolamento de duas empresas em execução; envio e entrega reais. Esses itens pertencem à implementação e à homologação, não a este estudo.
