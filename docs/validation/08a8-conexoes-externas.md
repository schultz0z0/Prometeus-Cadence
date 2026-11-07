# Conexões externas para homologação e produção

Inventário do código e dos relatórios do Prometeus em 07/11/2026. As credenciais entram no ambiente protegido. Use contas próprias de teste para a primeira rodada.

| Área | O que separar | Escopo |
|---|---|---|
| IA convencional central | Uma rota autorizada. OpenAI API com chave, modelo e saldo, ou Gemini API com chave, modelo e cota. ChatGPT OAuth direto exige conta e cota disponíveis. Codex CLI usa a sessão local autorizada. | Assistente, qualificação, pesquisa, sugestões e SDR usam a rota central. As opções são alternativas. Codex CLI e ChatGPT OAuth direto têm condições locais no código atual. Para homologação hospedada, validar uma rota compatível. |
| IA híbrida | Chave OpenRouter, acesso ao JEV `typesafe/jev-1.13` e cota. | Necessário quando a política usa o JEV para decisões. A geração continua na LLM convencional. |
| Apify | Token, Actors e builds de Maps, busca web e CNPJ, teto de custo e autorização para consumir. | Homologar resultados, acurácia, cobrança e recuperação de falhas com a rota central. |
| Apollo | Chave de uma conta com acesso à API de pesquisa, limites e orçamento, caso a fonte seja usada. | É uma fonte adicional. O workspace que usa a chave própria consome sua cota. |
| Gmail / Google Workspace | Cliente OAuth do Gmail, URL de retorno e caixa de teste. | Envio e leitura da caixa. Separar a autorização do Gmail do login Google. |
| Outras caixas de e-mail | Hosts e portas SMTP/IMAP com TLS, usuários, senhas e caixa de teste. | Alternativa ao Gmail por caixa. Validar envio e recebimento. |
| E-mail transacional e avisos | SMTP, usuário, senha, remetente autorizado e DNS do domínio de envio. | Cadastro, recuperação, convites e avisos. O código usa a configuração SMTP de notificações e o capturador local em QA. |
| Login Google | Cliente OAuth, segredo e callback do login da aplicação. | Autenticação de usuário. |
| Google Agenda e Sheets | Clientes OAuth, segredos e callbacks dos conectores, uma agenda e uma planilha de teste. | Agendamento do SDR e exportação para planilha são escopos distintos. |
| OpenWA gerenciado | Origem e chave administrativa do gateway, número próprio, contato próprio de teste e autorização de envio. | Pareamento, recibos, recebimento, resposta, parada de cadência e piloto do SDR. |
| WhatsApp Oficial da Meta | Token, identificadores de conta e número, segredo de assinatura e configuração de callback HTTPS. | Opcional se o piloto usar só OpenWA. Validar modelos e entrega com o número autorizado. |
| LinkedIn via Unipile | Contrato, `UNIPILE_DSN`, `UNIPILE_API_KEY`, `LINKEDIN_PUBLIC_URL`, conta própria de teste, aceite jurídico e decisão comercial. | Conexão, ações permitidas, callbacks e histórico. |
| CRM | Fornecedor escolhido, documentação da API, autenticação e ambiente de teste. | O conector precisa ser implementado. FunnelsFlow e MeetFlow seguem condicionados a contrato de integração se forem escolhidos. |
| MCP e webhooks | URL HTTPS do ambiente, contas de teste no Claude e ChatGPT e receptor de webhook de teste autorizado. | Exercitar OAuth, escopos e revogação em clientes reais e entrega assinada ao receptor. |
| Stripe live | Conta comercial, chaves live, segredo do webhook, catálogo live e autorização para cobrança. | O catálogo já foi homologado em modo de teste. A ativação live pertence ao 08B. |
| Infraestrutura | Host e domínio de homologação, DNS, TLS, Postgres e armazenamento/backup privados. | A URL pública viabiliza os callbacks. Implantação e abertura de acesso dependem da autorização específica. |

O piloto do SDR usa OpenWA, IA central e Google Agenda. A execução com CRM depende também do conector escolhido. A lista reúne os insumos previstos e não registra contratação, conexão ou aceites de provedores.
