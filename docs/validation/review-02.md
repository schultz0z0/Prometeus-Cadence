# Revisão final — marco 02

Revisão independente única de `6d944a6..1bfb6a7`, por `identity_review` (contexto novo, somente leitura), conforme `superpowers:executing-plans`. A primeira chamada não executou por limite de uso; o mesmo revisor foi retomado após o usuário continuar. Não houve segunda revisão nem nova delegação de implementação.

O revisor encontrou cinco problemas importantes e um classificado como menor. O executor reclassificou o retry do primeiro contato como importante: uma confirmação com resposta perdida precisa continuar recuperável. Os seis entraram em um único passe de correção, cada um com regressão observada falhar antes da mudança e passar depois.

| Achado | Correção e evidência |
| --- | --- |
| Administração atingia o workspace selecionado por outra aba | Conta/Membros enviam a expectativa do workspace exibido; serviço verifica a sessão atual dentro da transação e rejeita divergência com 409. Teste `stale administrative workspace expectation...` RED→GREEN. |
| Refresh permitia formulário antigo sobrescrever edição concorrente | Mudança externa de revisão coloca a tela em conflito e bloqueia novas gravações até recarregar/revisar explicitamente. Formulário permanece disponível para preservar o texto. Tentativas repetidas não contornam a proteção. Tests `an external refresh...` e `an uncertain retry...` RED→GREEN. |
| Convite duplicado restabelecia acesso após remoção | Migração 005 mantém um pendente por organização/e-mail normalizado. Retry reutiliza o convite; aceite/remoção/alteração de papel invalidam convites relacionados. Teste `duplicate pending invitations...` RED→GREEN. |
| Ação com vários comandos gravava parcialmente após falha | Geração, qualificação e ações em lote agora usam `leads.batch`, incluindo o job na mesma transação quando aplicável. Uma falha cancela comandos dependentes já enfileirados. IDs de simulação, job e lista permanecem estáveis no retry. Testes `one bulk action...`, `failed queue entry...` e `generation retry...` RED→GREEN. |
| Contexto perdido mantinha dados antigos na tela | 401/403 ou mudança de workspace invalidam o cache, retiram capacidades e substituem a superfície antiga. Somente texto digitado em campos não sensíveis fica recuperável temporariamente na memória. Teste `workspace mismatch or removal...` RED→GREEN. |
| Primeiro contato mudava de operação após resposta perdida | Destino e modo de criação ficam fixos desde a preparação do formulário. O retry continua a mesma importação atômica. Teste `first-contact retry...` RED módulo ausente→GREEN. |

As tentativas incertas mantêm **requestId e revisão originais**: se o commit já ocorreu, o servidor retorna o resultado idempotente; se outra aba gravou antes, retorna conflito. A revisão nova nunca é atribuída silenciosamente a um corpo antigo.

Verificação após as correções: **43 testes de domínio/cliente e 19 testes de integração passaram**. TypeScript, build de produção, smoke e validação renderizada constam em `02-identity.md`. Nenhum achado ficou adiado; não foi solicitada uma segunda revisão, conforme o processo nativo.

Na validação renderizada do mesmo passe, um rascunho aberto não sobrescreveu o template alterado por outra aba; o texto digitado permaneceu disponível. A troca de workspace substituiu toda a superfície antiga pela recuperação de acesso. Essa conferência detectou repetição dos valores durante a digitação no coletor de rascunhos: a regressão `draft recovery keeps only the latest edited value under a static label` falhou por módulo ausente e passou com o coletor por identidade de campo, que lê apenas a legenda estática e guarda somente o último valor editado. Senhas, arquivos e campos ocultos são excluídos.

## Comportamentos que o revisor deixou fora do julgamento

IA/provedores reais, envios, cobrança, scheduler, OAuth sem credenciais, deploy público/proxy e escala de snapshots são marcos posteriores no roteiro aprovado. O executor mantém esses limites: o custo é que esta entrega local ainda não é o SaaS comercial integral. Nova sessão sem workspace ativo usa o onboarding para selecionar uma associação existente; isso não representa perda de dados.

## Decisões tomadas durante a execução

1. Usar o diretório existente em uma branch própria preserva o preview do usuário; custo: isolamento por branch, sem checkout separado.
2. Registrar o processo em ledger compatível com Windows substitui helpers POSIX; custo: bookkeeping manual.
3. Preservar a resposta genérica de cadastro duplicado evita revelar contas existentes; custo: o cadastro não informa se o e-mail já existe.
4. Reaproveitar o esquema/plugin de organizações e aplicar mutações pelo serviço transacional de negócio garante a matriz de papéis; custo: manter compatibilidade com a versão fixada do esquema.
5. Enviar a expectativa de workspace em header, conferida contra a sessão, protege abas antigas; custo: essas abas precisam recarregar após troca de contexto.
6. Gravar os bytes nativos das capturas retornadas pelo MCP contornou a configuração incorreta de roots no export direto; custo: uma etapa local de exportação, sem edição das imagens.
7. Manter integrações reais e deploy fora desta entrega respeita o roteiro; custo: o ambiente continua local e sem execução externa.
8. Bloquear gravações após revisão externa é uma proteção conservadora para todos os formulários existentes; custo: recarregar e reaplicar a edição após comparar os dados.
9. Acrescentar `leads.batch` torna uma ação de lote atômica; custo: um contrato adicional de comando compartilhado entre cliente e servidor.

Estado Git: trabalho preservado na branch `feat/identity-postgres`, sem push, merge ou alteração de serviços externos. Não existe remote configurado neste repositório.
