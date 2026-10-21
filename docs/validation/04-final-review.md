# Revisão final — marco04

Revisão única, independente, em contexto novo, do intervalo `191330c..72a483b`, por gpt-6.1-sol. A tentativa gpt-6-astra não iniciou por limite de uso; a sessão substituta foi retomada após interrupção de permissão, sem segundo parecer. Leitura de banco/RLS, calendário/scheduler, planejamento/contexto, confirmação/UI e evidência. Nenhuma edição, execução de testes com efeitos ou chamada externa pelo revisor.

## Parecer original

Pontos fortes: separação entre analisar/criar/ativar; propostas imutáveis, hashes e reservas transacionais; contexto aprovado separado; tratamento de DST e recuperação limitada. Nenhum Critical ou Minor. Parecer: integrar com correções dos seis Important abaixo. Severidades confirmadas por efeito no usuário; todos foram reproduzidos.

| Achado | Evidência RED | Correção e GREEN |
|---|---|---|
| Calendários IA sem anchorDate impediam ativação | planning-confirmation: data undefined e scheduleV2 inválido | Data validada, preenchida em seleção, mostrada e congelada na revisão; lifecycle ativa calendário original sem edição reparadora |
| Backlog dependente sumia na próxima busca | dependent backlog: total0 quando esperado2 | Busca atual ainda deve terminar; inserts não atribuídos das buscas completed/partial anteriores permanecem elegíveis |
| Remover membro descartava resposta/consumo já recebidos | received-step: attempt prepared, consumo ausente | Função estreita e fenced para recibo técnico/uso; administrador atual inspeciona conteúdo; removido não acessa; sem publicação ou novo despacho |
| Última mostrava janela agendada sem executar | queued/waiting tinha lastRunAt | Só primeira claim real de processamento preenche started_at e lastRunAt; janela/histórico separados |
| Revisão omitindo escopo autorizado | review.scope undefined | DTO público e modal mostram fonte/lista/filtros/módulos/critérios/dependência e versões de contexto/produto, sem fingerprint |
| Reativação misturava autorização nova com espera antiga | waiting continuava depois de nova ativação | Cancelar ocorrências waiting-only anteriores e limpar pointer ao ativar; novas janelas recebem vínculo consistente |

Correção adicional dentro do mesmo passe de recebimento: o recibo de um run remoto Apify após revogação continua elegível ao cleanup estreito já existente. Teste RED sem ticket→GREEN ticket/ack sintético; nenhum run real foi iniciado ou abortado.

Migrações018–020 são aditivas:016/017 aplicadas nunca foram editadas.019 corrige a qualificação de alias em PL/pgSQL exposta pelo teste018.020 preserva o cleanup remoto. Os recibos aceitam somente tentativa preparada do job/ator/lease/fence existentes, saída limitada e unidades dentro da intenção/reserva. Gravar recibo não cria lead, proposta ou nova autorização. Conteúdo retido é mostrado apenas a administradores atuais e não é aplicado automaticamente. Uma lease já obsoleta continua exigindo reconciliação, sem publicação tardia.

## Comportamentos que o revisor deixou fora do julgamento

1. Compatibilidade real de provedores e precisão empírica: piloto externo não autorizado; fixtures comprovam contratos, não respostas reais. Decisão: manter limite e exigir aceite próprio, com risco de diferenças do provedor.
2. Envio, inbox, stop-on-reply operacional e billing: marcos seguintes. Decisão: não antecipar, produto comercial/canais ainda incompletos.
3. Deploy público, supervisão e recuperação de desastre executada: aceite local. Decisão: não alegar prontidão de produção; operação real permanece sem validação.

Sem menores adiados. Não houve segunda revisão: cada correção foi demonstrada RED→GREEN e o passe termina com suíte completa, typecheck, build e smoke. Evidência final e decisões completas em `04-execution-record.md`; operação/limites em `04-automation-ai.md`.

Validação após o passe: **121/121 unitários,101/101 integração PostgreSQL e typecheck passaram**. Migrações014–020 aplicadas e repetidas nos dois bancos sem apagar dados. Build e smoke final constam no aceite04. Os seis Important estão resolvidos; nenhum menor adiado.
