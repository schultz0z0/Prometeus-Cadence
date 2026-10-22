# Prometeus Cadence

Reconstrução independente da interface e dos fluxos observados no CadenceFlow. **Marcos01–04 e implementação local05A: interface, identidade, PostgreSQL, prospecção, IA, automações e execução WhatsApp Meta/Twilio.** O aceite real dos canais depende das credenciais e do callback HTTPS de cada empresa. E-mail pertence ao marco05B.

## Executar

Node.js 24, npm e Docker Desktop ativo. Versões fixadas em `package-lock.json`.

```powershell
rtk npm ci
rtk npm run env:init
rtk npm run db:up
rtk npm run db:migrate
rtk npm run dev
```

Abrir [http://127.0.0.1:3210](http://127.0.0.1:3210). A porta 3210 evita conflito com outro serviço local. Para produção local: `rtk npm run build` e depois `rtk npm start`.

Crie uma conta em `/register`, confirme o link no [capturador local de e-mails](http://127.0.0.1:8125) e crie seu workspace. Verificação, recuperação e convites são enviados exclusivamente ao capturador local. Google permanece indisponível sem `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` próprios.

O Compose `prometeus-cadence` tem PostgreSQL em `127.0.0.1:55432`, SMTP em `127.0.0.1:1125`, volume e credenciais exclusivos. `env:init` cria `.env.local` com segredos aleatórios somente se o arquivo não existir. Não apague o volume para reiniciar. O ambiente atende desenvolvimento local; um deploy público exige configuração própria.

## O que funciona neste marco

- Navegação, dashboard, passeio guiado, tema e tamanho do texto.
- Cadastro, verificação de e-mail, login, logout, recuperação de senha, gestão e revogação de sessões.
- Workspaces com proprietário, administradores e operadores; convites temporários vinculados ao e-mail verificado.
- Persistência no servidor, controle de revisão, confirmação idempotente, transações e isolamento por RLS.
- Contatos, listas, filtros, ficha, cadastro, edição e importação CSV/TXT com revisão antes de salvar.
- Templates, variáveis e prévia com avisos quando faltam valores.
- Prospecção e qualificação com revisão, jobs PostgreSQL, worker separado, deduplicação, evidências e uso. Adaptadores Apify/Apollo, JEV1.13, Codex CLI local, OpenAI e Gemini. Política por workspace e teste confirmado em Provedores de IA; três inferências Codex reais validadas no aceite03B.
- Planejamento por IA: leitura de site com fontes, três propostas de público e cadência, edição humana e criação confirmada de lista/automações pausadas ou cadência em rascunho.
- Agendador PostgreSQL separado, desligado por padrão: autorizações por revisão, próxima ocorrência, execução avulsa, histórico, dependência busca→qualificação e backlog sem requalificação automática dos resultados pendentes.
- Cadência por etapas, revisão de mensagens, canvas editável, esperas, ordenação, zoom, configurações e rascunhos.
- Contexto da empresa editável e versionado, conexão Meta/Twilio por workspace com segredos cifrados, catálogo remoto, teste confirmado e limites compartilhados.
- Publicação imutável de cadência WhatsApp, outbox PostgreSQL, tentativas com recuperação/resultado incerto, inbox real, resposta revisada e cancelamento por resposta/opt-out. Worker independente, desligado por padrão; validação externa Meta/Twilio pendente.

Contas novas começam vazias. Contatos, templates, contexto versionado, produtos aprovados, cadências, automações e propostas de IA ficam no PostgreSQL; preferências pessoais são separadas das configurações do workspace. Uma análise cria somente job e proposta. Nenhuma criação ativa envio. Busca pontual exige confirmação, configuração e worker ativo.

O modo demonstrativo anterior permanece disponível ao definir explicitamente `APP_DATA_MODE=demo` no ambiente e reiniciar o app. Ele usa dados fictícios na chave `prometeus-cadence-demo-v1` do localStorage, com banner próprio. Esses dados não são importados automaticamente para contas reais; falhas no banco nunca ativam a demonstração como fallback.

## Limites e próximas entregas

LinkedIn, SDR e billing ainda não estão integrados. Gmail OAuth e SMTP/IMAP têm implementação local05B, com piloto de conta real pendente. Meta/Twilio têm implementação e contratos locais, mas não foram ativados com contas reais nesta entrega. Execuções externas, scheduler e worker de mensagens começam desabilitados. Valores desconhecidos não são inventados.

Para configurar e operar05B, consulte [E-mail: configuração e operação](docs/operations/EMAIL-SETUP.md), [piloto conjunto Meta/Google/SMTP](docs/operations/CHANNELS-PILOT.md) e [validação05B](docs/validation/2026-10-21-email-05b.md). Acesse `/settings/email`, `/messages/email` e `/inbox?channel=email`. Sync, envio e piloto têm gates separados e começam desligados. A IA não responde autonomamente; cada resposta/publicação exige revisão. Credenciais reais permanecem para o trabalho manual final.

Para configurar e operar05A, consulte [WhatsApp: configuração, recuperação e piloto](docs/operations/WHATSAPP-SETUP.md) e a [validação05A](docs/validation/2026-10-21-whatsapp-05a.md). Acesse `/settings/whatsapp`, `/cadences` e `/inbox`. Salvar/verificar/sincronizar não envia; teste, resposta e publicação exigem revisão e confirmação. Credenciais de cada empresa são preenchidas no app. O piloto real fica para a configuração manual final do usuário; nenhum domínio/túnel foi exposto automaticamente.

Para operar o marco04, consulte a [validação e operação04](docs/validation/04-automation-ai.md). Os processos são independentes: aplicativo3210, `rtk npm run scheduler` e `rtk npm run worker`. O scheduler exige `AUTOMATIONS_SCHEDULER_ENABLED=true`, revisão de ativação e configuração/cotas válidas; não é iniciado pelo aplicativo. `rtk npm run scheduler -- --once --workspace ID` processa no máximo uma ocorrência elegível. Desligá-lo não cancela jobs já criados; pause a automação para impedir novos despachos recorrentes e trate jobs enviados no histórico. Não aumentar budgets para executar um teste.

Configure e opere prospecção conforme a [validação03](docs/validation/03-prospecting.md) e o [roteamento03B](docs/validation/03b-ai-routing.md). Sem JEV, a LLM convencional selecionada faz qualificação e geração. JEV habilitado exige uma convencional com teste válido; nunca roda sozinho. Worker: `rtk npm run worker`. Chaves somente no ambiente local, nunca chat/Git. Codex CLI via ChatGPT é restrito aos testes locais autorizados; JEV usa OpenRouter Decisions API.

O [roteiro aprovado](docs/superpowers/plans/2026-10-20-prometeus-cadence-roadmap.md) divide as próximas entregas em identidade/organizações, assinatura, prospecção, IA, execução de cadências, canais e operação. Os conectores devem usar serviços próprios e credenciais do produto. A tecnologia interna do concorrente permanece desconhecida onde não houve evidência.

## Verificar

```powershell
rtk npm test
rtk npm run db:migrate -- --test
rtk npm run test:integration
rtk npm run typecheck
rtk npm run build
rtk proxy node scripts/smoke-routes.mjs
```

O último comando requer o servidor local ativo. Os testes de domínio verificam transições e comportamento assíncrono; a integração usa o banco exclusivo com sufixo `_test`, preparado pelo comando de migração de teste. O smoke exige redirecionamento para login nas rotas protegidas e 401 nas APIs sem sessão. Nenhum teste chama provedores externos.

- [Validação e capturas](docs/validation/01-interface.md)
- [Validação de identidade e isolamento](docs/validation/02-identity.md)
- [Validação de prospecção e IA híbrida](docs/validation/03-prospecting.md)
- [Validação do roteamento e Codex ChatGPT](docs/validation/03b-ai-routing.md)
- [Validação do planejamento e agendador04](docs/validation/04-automation-ai.md)
- [Validação local de WhatsApp05A](docs/validation/2026-10-21-whatsapp-05a.md)
- [Especificação aprovada](docs/superpowers/specs/2026-10-20-prometeus-cadence-design.md)
- [Investigação e evidências REA](docs/reverse-engineering/README.md)

`src/domain` contém contratos e regras puras; `src/server` contém identidade, permissões, transações e comandos; `src/client` faz o transporte autenticado. `src/demo` preserva o demonstrativo; `src/modules` contém os fluxos; `src/app` contém as rotas e estilos. Bundles capturados da referência não são dependências do aplicativo.
