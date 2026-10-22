# E-mail 05B — pesquisa para o desenho

Data: 21/10/2026. Base local: `b84e44e`. Pesquisa documental, sem autorizar contas, instalar dependências ou enviar mensagens.

## Escolha do usuário e evidência local

O usuário escolheu Gmail/Google Workspace por OAuth e SMTP + IMAP. Configuração manual de chaves, consoles, DNS e testes externos fica para o final, junto com Meta e Google. Microsoft OAuth não entra nesta entrega.

A engenharia reversa preservada em `../reverse-engineering/FINDINGS.md` identifica conexões OAuth/SMTP/IMAP no cliente, inbox com recebidos/enviados e sincronização, assinatura, referências a DNS/DKIM e rastreio. A conta original não permitiu exercitar essas conexões. Os números de 80 recomendados/100 máximos por caixa são declarações da interface, não capacidade comprovada nem limites de nossos provedores.

No projeto, `src/server/auth/auth.ts` usa Google apenas para login e `src/server/auth/mail.ts` entrega autenticação ao capturador local. Nenhum dos dois constitui conexão Gmail de um workspace. O runtime 05A aceita somente WhatsApp; `PublicationSnapshot`, identidade, política e funções SQL precisam de evolução explícita para e-mail e sequências mistas. Não basta acrescentar uma chamada SMTP.

## Gmail

- Usar Gmail API para envio e leitura; solicitar `gmail.send` e `gmail.readonly`, além da identificação necessária. O primeiro é sensível e o segundo restrito. O processo de publicação pública e a avaliação de segurança aplicável devem constar da operação do SaaS. Não ampliar o login Google para acesso à caixa silenciosamente. [Escopos oficiais](https://developers.google.com/workspace/gmail/api/auth/scopes).
- OAuth de servidor fornece renovação de acesso. Projetos externos em modo Testing podem ter refresh tokens de sete dias quando solicitam permissões Gmail; reconexão precisa ter estado visível. Não prometer conexão permanente no piloto. [OAuth oficial](https://developers.google.com/identity/protocols/oauth2/).
- Envio usa MIME codificado em base64url. Para encadear respostas, usar o `threadId` remoto e cabeçalhos `References`, `In-Reply-To` e assunto compatíveis; um assunto igual sozinho não identifica uma conversa. [Envio](https://developers.google.com/workspace/gmail/api/guides/sending), [threads](https://developers.google.com/workspace/gmail/api/guides/threads).
- Sincronização incremental pode usar `history.list`. Persistir o cursor somente após processar todas as páginas; histórico expirado exige recuperação explícita. IDs não são sequenciais e devem ser tratados sem perda de precisão. [History](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list), [sincronização](https://developers.google.com/workspace/gmail/api/guides/sync).
- Recomenda-se polling com orçamento e backoff no 05B. Pub/Sub adicionaria tópico, permissões e renovação de watch; não é necessário para o primeiro piloto. Polling não oferece recebimento instantâneo.
- A política do Google proíbe distribuir spam ou mensagens comerciais não solicitadas; CRM com consentimento do destinatário é um exemplo permitido. Contato obtido por scraping não é prova de autorização. A conexão por outro protocolo não deve ser apresentada como forma de contornar essa política. [Política Workspace](https://developers.google.com/workspace/workspace-api-user-data-developer-policy).
- A documentação de quotas foi atualizada em maio de 2026 e distingue projetos novos de antigos. Há quotas por projeto/usuário, consumo diferente por método e anúncio de futura cobrança por excesso. Não congelar números antigos nem prometer custo zero permanente; monitorar consumo e configurar orçamento do projeto no piloto. [Quotas oficiais](https://developers.google.com/workspace/gmail/api/reference/quota).

## SMTP e IMAP

- Nodemailer já está instalado. `verify()` testa conexão/TLS/autenticação, mas não comprova que um remetente será aceito num envio. Usar TLS obrigatório, certificado válido, timeouts, um destinatário por operação e impedir leitura de arquivos/URLs pelo compositor. [Transporte SMTP](https://nodemailer.com/smtp).
- ImapFlow é candidato ao cliente IMAP; a versão será fixada no plano depois de verificar o pacote. Usar caixa em leitura, lock, UID e UIDVALIDITY persistidos. Alteração de UIDVALIDITY invalida o cursor antigo. Não executar CLOSE com efeito de expunge, alterar flags ou excluir mensagens no provedor. [Gestão de caixas](https://imapflow.com/docs/guides/mailbox-management/), [API](https://imapflow.com/docs/api/imapflow-client/).
- MailParser, do mesmo ecossistema, é candidato a parsing MIME com streaming e limites definidos pela aplicação. Não renderizar HTML recebido diretamente; anexos podem ser identificados sem armazenar seus bytes nesta entrega. [Documentação](https://nodemailer.com/extras/mailparser).
- Hosts informados por clientes exigem proteção de rede: resolução e conexão ao mesmo endereço público validado, SNI para o hostname original, bloqueio de redes internas/metadata e sem proxy arbitrário. Uma validação de DNS seguida de nova resolução independente não resolve rebinding. Fixtures locais pertencem exclusivamente ao ambiente de teste.

## Semântica de entrega e descadastro

SMTP aceitar uma mensagem significa assumir seu encaminhamento, não confirmar chegada à inbox do destinatário. Gmail send também não fornece por si só recibo de leitura. A UI deve distinguir aceitação, falha posterior comprovada e resultado incerto. [SMTP — RFC 5321](https://www.rfc-editor.org/rfc/rfc5321.html).

Campanhas terão descadastro visível e endpoint idempotente. O padrão one-click usa POST e cabeçalhos próprios; sua apresentação pelos provedores depende também de assinatura DKIM cobrindo os cabeçalhos. Não declarar conformidade completa só por inserir duas linhas no MIME. [RFC 8058](https://www.rfc-editor.org/rfc/rfc8058.html).

O piloto precisa conferir autenticação do domínio e requisitos reais do provedor. Recomenda-se SPF, DKIM e DMARC com diagnóstico que distingue observado, ausente e não verificado. Presença de TXT não comprova alinhamento de uma mensagem entregue. [Diretrizes Gmail](https://support.google.com/mail/answer/81126).

## Recursos e limites

Reaproveitar PostgreSQL, isolamento, cifra, revisão assinada, outbox, scheduler e Nodemailer existentes. Avaliar ImapFlow e MailParser como bibliotecas, sem criar servidor próprio de e-mail. O usuário dispensou a consulta ao antigo acervo O Setup anteriormente; não houve acesso a setup-agent.

Nenhuma credencial foi consultada ou registrada nesta pesquisa. Não houve nova inspeção do CadenceFlow nem afirmação de paridade conectada. A pesquisa informa o desenho; não comprova interoperabilidade dos adaptadores ainda não implementados.
