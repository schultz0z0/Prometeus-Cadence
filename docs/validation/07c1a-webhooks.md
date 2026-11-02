# 07C.1a — Webhooks de saída

Data: 02/11/2026. Estado: concluído local/controlado após revisão independente ([revisão](07c1a-webhooks-review.md)). [Plano do pacote](../superpowers/plans/2026-11-02-prometeus-cadence-07c1a-webhooks.md). A API pública com tokens fica no 07C.1b. Não é aceite de paridade 100% nem de produção pública.

## Contrato entregue

- **Página "Webhooks e API"** fiel à referência:
  - até 10 destinos, cada um com nome, URL e badges de eventos e listas;
  - contagem de entregas e alerta de falhas seguidas;
  - interruptor de ativo/pausado, testar, histórico, editar e excluir com confirmação;
  - segredo gerado e mostrado uma vez (confirmação ao gerar um novo), ou colado pela pessoa;
  - diálogo com nome, URL pública, segredo, os 5 eventos de lead e o escopo de listas.

  Os eventos do agente aparecem desabilitados, com a explicação de que o Agente SDR ainda não existe.
- **Eventos gravados por trigger na transação do efeito:**
  - `lead.created`, exceto na restauração real de uma fusão;
  - `lead.qualified`;
  - `lead.connected`, só para respostas humanas: no WhatsApp ao receber, no e-mail depois da classificação humana e do vínculo com a thread do app; respostas automáticas e bounces não contam.

  Um commit abortado não deixa evento. A emissão nunca derruba a escrita de domínio: payload grande vira referência e erro vira aviso. Só destinos ativos que assinam o evento e a lista recebem a entrega.
- **Segurança da entrega:**
  - segredo cifrado (AES-GCM, AAD do destino) e nunca devolvido;
  - DNS e IP públicos validados na revisão e a cada tentativa, com conexão fixada no IP aprovado (contra rebinding);
  - redirecionamento não é seguido, timeout de 10 s e corpo de até 256 KiB;
  - assinatura HMAC SHA-256 do corpo em `X-Webhook-Signature`, com `idempotencyKey` estável;
  - somente proprietário ou administrador gerencia.
- **Fila e retentativas:**
  - lane próprio `integrations`, com um lease por tentativa e no máximo uma tentativa por destino por tick, para um receptor lento não travar outros tenants;
  - retentativas em 1 min/5 min/30 min/2 h/6 h até 24 h, só para 429, 5xx e rede, com `Retry-After` respeitado;
  - 401/403/410/3xx e endereço não público colocam o destino em atenção e retêm a fila sem laço; "Tentar de novo" e editar liberam;
  - destino pausado nunca recebe, mesmo com a tentativa em andamento;
  - entrega pelo menos uma vez, com resultado incerto registrado.
- **Privacidade:**
  - exclusão de lead cancela as entregas pendentes e apaga a cópia;
  - eventos são retidos por 30 dias;
  - a resposta carrega o lead e o canal, não o texto da mensagem.

## Validação executada

- **Unitários:** 3/3 do domínio (retentativa, agenda, `Retry-After`, esquema e correspondência).
- **Integração focada:** 8/8.
  - commit abortado, assinatura e id estável;
  - endereços privados, rebinding e redirecionamento;
  - 429/5xx/401 e limite de 24 h;
  - assinaturas, listas e canais;
  - permissão, isolamento, segredo único, limite e contrato HTTP;
  - justiça por destino e pausa durante a tentativa;
  - payload grande, exclusão e e-mail não classificado;
  - teste sob alerta, contagem de falhas e create repetido com dados diferentes.
- **Suítes completas:** 381/381 unitários, 501/501 integrações (o teste de desempenho do 06C.2 passou com p95 de 112 ms; a falha isolada anterior, de 262 ms, foi ruído de carga), build e tipos exit 0, `git diff --check` limpo.
- **RED:**
  - sem a migração 095, todos os testes falharam;
  - sem a 095a, os 3 testes da revisão e os que dependem do novo worker falharam.

## QA no navegador

Conta descartável `[RE] QA Webhooks`, sem leads, para não gerar eventos. Testado:
- estado vazio;
- URL privada bloqueada no diálogo;
- criação com URL pública;
- segredo gerado uma vez (banner fechado antes da captura);
- histórico vazio, pausar e editar;
- sem overflow em 390 e 320 px;
- exclusão com confirmação.

"Testar" não foi clicado e nenhum POST externo foi feito, conforme o gate do plano.

A 1920×855, o painel tem 1152×303 em y=195 (referência: 1152×301 em y=194).

## QA, runtime e custos

- **L-031 removed:** conta e workspace removidos por IDs exatos, sem resíduo; 0 eventos e 0 entregas.
- **Migrações:** 095/095a aplicadas localmente.
- **Runtime:** reiniciado com o lane `integrations`.
- **Custo externo:** zero; nenhum POST a terceiros.
- **Entrega:** sem merge, push ou deploy.

## Limites

- Nenhuma entrega real a um receptor externo foi feita; o caminho HTTP está coberto pelo request injetado nos testes.
- O caminho positivo da resposta por e-mail (classificação humana mais vínculo pela outbox) não tem teste dedicado; o negativo tem.
- As portas aceitas são 80 e 443, herdadas de `approvePublicUrl`; receptores em outras portas ficam para decisão do 07C.1b ou 08B.
- A chave OpenAI própria da referência ficou fora (IA central, decisão do usuário).
- A forma exata do payload da referência não foi observada; o envelope é próprio, com o lead, a lista e a mensagem sem texto.
