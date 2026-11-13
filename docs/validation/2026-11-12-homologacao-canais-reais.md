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

## Prospecção real — 13/11/2026

Lista "Homologação · Contabilidade RJ 2". Nenhuma mensagem foi enviada a esses leads.

| Etapa | Resultado |
| --- | --- |
| Geração (Maps) | 10 escritórios de contabilidade do Rio em 16 s; 10 inseridos, sem duplicados; US$ 0,04 no Apify |
| IA da plataforma | Chave do Gemini cadastrada pela nova tela de Provedores de IA, guardada cifrada; teste de conexão com `gemini-4-hydrogen` aprovado |
| Contexto de IA | Perfil de cliente ideal preenchido e aprovado (v4); sem ele a IA não decidia aderência |
| Qualificação (8 módulos) | 10 leads em 17 min; 11 chamadas Gemini, 20 execuções Apify (US$ 0,12, 1 tempo esgotado); CNPJ confirmado em 5, 1 lead aderente, 9 pendentes por falta de dado de porte nas fontes |
| Revisão | "Selecionar todos" marcou os 10; endereço da Receita rejeitado num lead e mantido o do Maps; aplicação conferida no banco |

| Enriquecedor | 5 empresas com CNPJ em 10 min; 9 sócios do cadastro registrados na ficha, sem contato pessoal publicado; nenhum crédito comercial consumido; nenhuma lista de decisores criada. US$ 0,16 no Apify (CNPJ 0,04; busca Google 0,06; LinkedIn 0,06) |
| LinkedIn dos sócios | A busca no Google trouxe 8 perfis de outras pessoas; o app descartou todos, sem associar a sócios |

Defeitos encontrados e corrigidos nesta etapa:

- Chaves de OpenAI e Gemini só entravam pelo arquivo de ambiente; agora o administrador da plataforma as cadastra na tela, com validação no provedor.
- O extrator de telefones propunha números sem DDD ou trocava o celular do Maps pelo fixo do site; agora normaliza para +55 com DDD e mantém o telefone que o lead já tem.
- A revisão só aceitava o lead inteiro; agora há "Selecionar todos" e escolha campo a campo.
- A consulta cadastral trocava cidade, estado e endereço já preenchidos pelo formato da Receita; agora só preenche campos vazios.
- A busca de CNPJ falhava com 403: a versão fixada do robô de busca do Google foi removida pelo Apify; fixada a 0.0.489.

## Pendências

- Cadência por e-mail exige endereço HTTPS público para o descadastro (08B).
- Mensagens recebidas enquanto o número está pausado não são relidas ao liberar.
- O Enriquecedor paga a leitura de perfis do LinkedIn cujo resultado de busca não cita o nome do sócio; todos acabam descartados.
- A faixa "teste grátis" do topo continuou visível depois da assinatura Pro; não investigado.
