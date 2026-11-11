# Assistente com IA real — 11/11/2026

Até aqui o assistente só tinha prova com IA simulada (06f1 e 06f2); na última tentativa real, a rota central respondeu limite de assinatura. Em 11/11/2026, com a nova conta de IA conectada pelo operador, ele foi exercitado com IA real.

## Como

`scripts/homologate-prospecting.mjs --confirm-provider-cost --sources=NONE --assistant` cria uma conta `[RE]` descartável e uma lista vazia, entra com sessão real e faz duas perguntas por `POST /api/assistant`, a mesma rota da interface. A proposta gerada é cancelada pela rota `/api/assistant/<id>/cancel`, então nada é executado. No fim a conta é removida; não sobrou nenhum resíduo.

## Resultado

| Pergunta | Resposta | Citações | Proposta |
| --- | --- | --- | --- |
| "Como eu conecto o WhatsApp para enviar mensagens?" | IA real (`fallback=false`), 5 a 23 s. Indica Configurações › WhatsApp e os limites do QR Code, e diz que o WhatsApp da conta não está conectado. | artigo `whatsapp-connect` e fatos da conta | nenhuma |
| "Qualifique a lista …" | IA real, 6 a 10 s. Diz que preparou uma proposta para revisão e que nada foi executado, avisa que a lista está vazia e explica onde qualificar. | artigo `qualifier` e fatos da conta | `qualify-list` na lista do catálogo, cancelada |

O contador diário caiu a cada pergunta (de 29 para 28).

## Defeito encontrado e corrigido

Na primeira rodada, o pedido "Qualifique a lista" não encontrou o artigo do Qualificador: a palavra-chave `qualifica` não casa com "qualifique". Sem o artigo, a IA respondeu que não sabia onde qualificar. Correções:

- A palavra-chave virou o radical `qualifi`.
- A Central de Ajuda ganhou o artigo do Enriquecedor, que não existia.

O teste em `tests/06f-assistant-experience.test.ts` cobre os dois casos. Na segunda rodada, a resposta citou o artigo certo.

## Cobertura do módulo

- **Serviço real:** rota central de IA convencional, pela conta conectada.
- **Caminho feliz:** resposta citada e proposta restrita ao catálogo do workspace.
- **Falha e recuperação:** IA indisponível ou com erro cai na resposta da Central de Ajuda, marcada como tal (06f1, com provedor controlado; observado também em produção local quando a rota respondeu limite de assinatura). A proposta só executa depois da confirmação e pode ser cancelada (06f2; aqui, cancelamento real).
- **Fora desta prova:** confirmar uma proposta com IA real (criaria cadência, automação ou execução paga) e o rascunho de resposta a uma conversa real, que depende de canal conectado.
