# Marco 02 — identidade e persistência local

Execução nativa do plano aprovado de 20/10/2026. A identidade e a arquitetura são implementações próprias: a investigação REA revelou superfícies e fluxos, não o backend privado do CadenceFlow. Skill REA e MCP REA 6.7.0 disponíveis; evidência preservada em `docs/reverse-engineering`.

## Ambiente

- Next 16.4.2, React 19.3.1, Node 24.16.0, Better Auth 1.7.12, pg 8.23.1, Zod 4.6.7, Nodemailer 10.1.7.
- PostgreSQL 18.6, imagem `postgres:18@sha256:885953109528ad3dfc90362b1a6f50a78620b5315be19f187753d267e484dc5b`.
- MailHog `mailhog/mailhog@sha256:8d76a3d4ffa32a3661311944007a415332c4bb855657f4f6c57996405c009bea` já instalado, reaproveitado em container próprio.
- Projeto Compose `prometeus-cadence`, banco 55432, SMTP 1125, caixa local 8125; nenhuma infraestrutura de outro projeto foi reutilizada.
- Migrações 001–004: fundação, esquema Better Auth, memberships e domínio normalizado. Roles de autenticação/aplicação separadas do migrador; runtime sem superuser/BYPASSRLS.

## Evidência de aceite

| Verificação | Resultado |
| --- | --- |
| Testes de domínio/cliente | 36 passaram |
| Integração real em banco `_test` | 16 passaram |
| TypeScript e build de produção | exit 0 |
| Smoke HTTP anônimo | 45/45; redirect esperado no app, 401 nas APIs privadas |
| Cadastro → e-mail local → workspace vazio | Exercitado em duas sessões Chrome isoladas |
| Contato manual, nova lista e recarregamento | Gravados e relidos no workspace A |
| Proposta → revisão → confirmação | Duas automações pausadas; resultado confirmado no PostgreSQL |
| Cadência com texto editado | Rascunho persistido com a correção humana |
| Template | Gravado no servidor pela interface |
| Workspace B | Zero leads, listas, templates, automações e cadências antes e após as gravações de A |
| Convite para operador | E-mail local, aceite e tentativa administrativa retornou 403 |
| Troca de workspace | Sessão B voltou ao seu workspace vazio |
| Reinício do banco | Contato, automações e cadência preservados; reconexão verificada |
| Console e layout | Sem erros relevantes no fluxo de produção; sem overflow horizontal no login móvel e contatos |

Os testes verificam: e-mail normalizado único sem revelar existência da conta, verificação obrigatória, cookie HttpOnly, origem/callback permitidos, limitação de tentativas, expiração, recuperação de uso único, revogação, propriedade do perfil/sessões; convites com e-mail errado/vencidos/usados; matriz de papéis e remoção; IDs iguais em dois workspaces, FKs compostas, RLS, pool sem contexto, rollback de importação, confirmação concorrente/idempotente, conflitos e limite de 500 registros. Preferências pessoais não atravessam membros.

No cliente, testes cobrem rejeição assíncrona sem sucesso/navegação, reuso de requestId após falha, ausência de publicação antes da resposta, 409 sem retry cego, resposta antiga após descarte do workspace, refresh atrasado e confirmação manual com Promise compartilhada.

## Navegador e capturas

Utilizada a skill de testes de frontend com o Chrome DevTools já conectado. O plugin Browser não está listado nesta sessão; nenhum runner ou navegador adicional foi instalado. Fluxo: `/register` → confirmação no MailHog → `/onboarding/workspace` → `/contacts` → `/automations/new/ai` → revisão → `/cadences/new/ai` → revisão → `/templates`. Contas de validação usam somente domínios `.example` e permanecem identificadas como validação.

Desktop 1440×900; login móvel solicitado a 390×844, com viewport efetivo de 500×844 imposto pelo Chrome com janela. Capturas nativas foram retornadas pelo MCP e salvas sem edição; o export direto do MCP recusou o caminho por configuração de roots, então foram gravados os bytes da imagem retornada no workspace autorizado.

- [Login desktop](screenshots/02/login-desktop.png)
- [Login móvel](screenshots/02/login-mobile.png)
- [Confirmação persistida](screenshots/02/automation-saved.png)

A composição de login mantém o painel escuro, formulário claro e ação laranja do print U01, com marca própria. O formulário de conta foi separado em perfil pessoal, nome do workspace e preferências. Google fica indisponível sem credenciais próprias; não há CAPTCHA inventado.

## Correções encontradas durante o aceite

- Request do Next é um proxy: o construtor nativo `new Request(request)` falhava. Teste reproduziu o erro; gateway agora constrói por URL, headers e corpo públicos.
- Refresh atrasado não pode reduzir a revisão publicada.
- Eventos de erro de conexões ociosas do pg recebem tratamento sem serializar objetos de conexão. Queries ativas continuam rejeitando e provocando rollback.
- Logging de rotas com links temporários foi desabilitado na configuração de desenvolvimento.

## Limites e retomada

SMTP captura tudo localmente. OAuth, assinatura, prospecção, IA real, scheduler e canais continuam pendentes. A conta real não implica que as simulações executem integrações; nenhuma mensagem ou cobrança foi ativada.

Dados do workspace são lidos em snapshot inteiro nesta fase; tabelas são separadas e as mutações usam comandos validados de até 2 MB. Paginação de grandes bases pertence ao marco de prospecção. Rate limiting considera loopback nesta entrega; deploy por proxy precisa de política de IP e HTTPS própria.

Retomada: `rtk npm run db:up`, `rtk npm run db:migrate`, `rtk npm run dev`. Para validar: `rtk npm test`, `rtk npm run test:integration`, `rtk npm run typecheck`, `rtk npm run build`; com o app ativo, `rtk proxy node scripts/smoke-routes.mjs`. A integração seleciona URLs do banco `_test` e recusa outro sufixo. Não apagar o volume de dados.

Revisão independente e decisões finais: `review-02.md`.
