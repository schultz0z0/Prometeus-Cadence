# Prometeus Cadence

Reconstrução independente da interface e dos fluxos observados no CadenceFlow. **Marco 01: aplicação local demonstrativa.** Ainda não é um SaaS pronto para clientes ou envios reais.

## Executar

Node.js 24 e npm. Versões fixadas em `package-lock.json`.

```powershell
rtk npm ci
rtk npm run dev
```

Abrir [http://127.0.0.1:3210](http://127.0.0.1:3210). A porta 3210 evita conflito com outro serviço local. Para produção local: `rtk npm run build` e depois `rtk npm start`.

## O que funciona neste marco

- Navegação, dashboard, passeio guiado, tema e tamanho do texto.
- Contatos, listas, filtros, ficha, cadastro, edição e importação CSV/TXT com revisão antes de salvar.
- Templates, variáveis e prévia com avisos quando faltam valores.
- Prospecção e qualificação com simulação local explicitamente identificada.
- Automações por formulário ou propostas demonstrativas: confirmação cria lista e automações pausadas em uma transação.
- Cadência por etapas, revisão de mensagens, canvas editável, esperas, ordenação, zoom, configurações e rascunhos.
- Contexto da empresa editável e versionado, canais desconectados, inbox de exemplo, relatórios e demais superfícies.

Os dados de exemplo são fictícios e ficam neste navegador, na chave `prometeus-cadence-demo-v1` do localStorage. Não há autenticação nem sincronização entre dispositivos. Propostas não confirmadas são temporárias; rascunhos confirmados persistem. Dados inválidos mostram recuperação e bloqueiam salvamento até restaurar a demonstração.

## Limites e próximas entregas

IA, pesquisa externa, WhatsApp, e-mail, LinkedIn, SDR, billing e agendamentos **não estão conectados**. Não se enviam mensagens, consomem créditos nem executam buscas reais. Os horários das automações são configurações locais, não jobs ativos. O botão de conectar explica o serviço pendente. Valores de mercado e preços desconhecidos não são inventados.

O [roteiro aprovado](docs/superpowers/plans/2026-10-20-prometeus-cadence-roadmap.md) divide as próximas entregas em identidade/organizações, assinatura, prospecção, IA, execução de cadências, canais e operação. Os conectores devem usar serviços próprios e credenciais do produto. A tecnologia interna do concorrente permanece desconhecida onde não houve evidência.

## Verificar

```powershell
rtk npm test
rtk npm run typecheck
rtk npm run build
rtk proxy node scripts/smoke-routes.mjs
```

O último comando requer o servidor local ativo. Os testes de domínio verificam persistência, atomicidade, confirmação idempotente, filtros, importação, prévia e validação. O smoke verifica respostas HTTP das rotas; não representa teste de integrações externas.

- [Validação e capturas](docs/validation/01-interface.md)
- [Especificação aprovada](docs/superpowers/specs/2026-10-20-prometeus-cadence-design.md)
- [Investigação e evidências REA](docs/reverse-engineering/README.md)

`src/domain` contém os contratos e regras puras; `src/demo` contém o repositório e os simuladores; `src/modules` contém os fluxos; `src/app` contém as rotas e os estilos. Os bundles capturados do produto de referência não são dependências do aplicativo.
