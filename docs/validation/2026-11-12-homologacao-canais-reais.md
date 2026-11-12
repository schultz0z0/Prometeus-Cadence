# Homologação com canais reais — 12/11/2026

Workspace único "Agência Prometeus", conta administradora da plataforma. O operador aprovou no chat os envios para os próprios contatos pessoais.

## Resultado

| Item | Resultado |
| --- | --- |
| Plano | Pro ativo, assinado pelo Checkout do Stripe em modo de teste com cartão de teste. Ativação conferida pela reconciliação com o Stripe |
| IA da plataforma | ChatGPT OAuth como LLM convencional; teste de conexão aprovado |
| Contexto de IA | Leitura do site da agência concluída, com fontes; aceite e aprovação ficam com o operador |
| E-mail | Caixa Gmail conectada por OAuth e pronta; resposta externa recebida; e-mail de teste aceito pelo Gmail |
| WhatsApp | OpenWA v0.30.0 com motor Baileys; QR em segundos; mensagem recebida; teste entregue no aparelho |
| Cadência real | Duas etapas de WhatsApp só para o operador. A etapa 1 foi entregue; a resposta do operador parou a inscrição (`stopped`, motivo `reply`) antes da etapa 2 |

## Defeitos encontrados e corrigidos

- Login falhava pelo endereço `localhost`; em desenvolvimento ele agora redireciona para a origem confiável.
- Conectar Gmail exigia um segundo clique; uma caixa nova vai direto ao consentimento do Google.
- Caixa de e-mail desconectada não saía da lista; agora pode ser removida, preservando o histórico.
- O recebedor do OpenWA recusava todo evento: o `deliveryId` atual vem como `dlv_<uuid>`.
- O motor `whatsapp-web.js` não inicia com o WhatsApp Web atual (`null Socket`); a plataforma passou ao Baileys.
- Contatos chegavam só como `@lid`; o recebedor e a recuperação consultam o telefone no OpenWA.
- Telefone de lead sem +55 bloqueava autorização e publicação de WhatsApp; passa a ser lido como brasileiro.
- A recuperação do OpenWA pausava o número a cada envio por 0,3 s de diferença entre o relógio do OpenWA e o do WhatsApp; agora tolera até 2 minutos.

## Pendências

- Cadência por e-mail exige endereço HTTPS público para o descadastro (08B).
- Geração e qualificação de leads reais: o token do Apify configurado foi recusado e precisa ser trocado pelo operador.
- Mensagens recebidas enquanto o número está pausado não são relidas ao liberar.
- A faixa "teste grátis" do topo continuou visível depois da assinatura Pro; não investigado.
