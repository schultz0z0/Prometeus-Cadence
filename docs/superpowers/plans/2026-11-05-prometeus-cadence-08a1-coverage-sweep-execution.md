# 08A.1 — Registro de cobertura e varredura de rotas

05/11/2026. Primeira parte do [08A](2026-10-27-prometeus-cadence-08a-final-regression.md). O 08A foi dividido:
- **08A.1 (este):** registro auditável, varredura de todas as rotas e correção do que ela achar.
- **08A.2:** jornadas clicadas de ponta a ponta, teclado, zoom 200 e atrasos, offline e 503.

O aceite integral do 08A **não pode fechar** nesta rodada: piloto do SDR, Unipile e OAuth dependem de contas e autorizações do usuário. O auditor existe para dizer isso com precisão, não para contornar.

## Regras do registro

- **Quem aprova:** nada é marcado à mão como aprovado.
  - **Rotas:** vêm do relatório da varredura; rota sem execução em todos os viewports fica pendente.
  - **Jornadas e módulos:** só contam com evidência cujo arquivo existe; captura de tela sozinha não vale.
  - **Módulo operacional:** exige serviço, caso feliz, falha, recuperação e efeito externo próprio, quando houver.
- **Bloqueado:** item bloqueado precisa dizer por quem. Não conta como aprovado.
- **Referência desconhecida:** é limite de prova, classificado à parte, e não dispensa a função local.
- **Rota nova:** toda `page.tsx` precisa estar no registro, senão o teste falha.
- **Aceite:** 100% dos itens obrigatórios, nenhuma falha crítica e nenhum desconhecido sem classificação.

## Varredura

`tests/manual/route-sweep.mjs`, com Playwright e Chromium já presentes na máquina:
- todas as rotas em 1920, 1440, 768, 390 e 320 px, mais tema escuro em 390;
- duas contas `[RE]` descartáveis e uma visita anônima às páginas públicas;
- mede status, erro de página, resposta 5xx, overflow horizontal e controle sem nome acessível;
- bloqueia requisições a hosts que não sejam locais; só navega, sem clicar em nada.

## Integração

Dois workspaces: recurso do outro responde 404 e não aparece em lista; usuário removido perde o acesso. Inclui o débito herdado do 06C.3: o isolamento do resumo semanal precisa provar primeiro que o fato conta na origem.

## Testes (RED primeiro)

- **Unitários:** regra de aceite, auditor (sem evidência, captura sozinha, sem bloqueador, módulo incompleto, desconhecido sem classe) e registro cobrindo todas as `page.tsx`.
- **CLI:** registro incompleto sai com código diferente de zero e lista as pendências.
