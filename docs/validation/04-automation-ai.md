# Marco04 — planejamento e automações

Aceite local em21/10/2026. Execução nativa na branch `codex/automation-ai-scheduler`; integração à main depende da escolha do usuário. Referências: especificação e plano04 aprovados, levantamento REA preservado em `docs/reverse-engineering`. O backend do concorrente permanece desconhecido.

## Entrega

Leitura pública de site com fontes, comparação de campos e aplicação ao rascunho; aprovação separada de contexto/produtos. Três propostas reais pelo provedor configurado, edição e confirmação idempotente para públicos e cadências. Uma análise não cria listas, automações ou cadências. Prévia de mensagem só entra no editor por aceitação, sem enviar ou salvar automaticamente.

Definições de automação, autorizações, ocorrências e atribuições são versionadas no PostgreSQL. Busca e qualificação dependente usam jobs/worker existentes, critérios e contexto/produto congelados. Ativação administrativa, execução avulsa, pausa, próxima/última janela, backlog, bloqueios e histórico disponíveis. Intervalos respeitam calendário/fuso, DST e última janela vencida; não se cria uma cobrança por cada dia perdido. Leads atribuídos pendentes de revisão, incertos ou tentados não voltam automaticamente para qualificação.

## Evidência

- Unitários121/121 e integração PostgreSQL101/101 passaram, incluindo ciclo integrado e regressão de escopo; typecheck e build de produção passaram. Revisão independente concluída, seis Important corrigidos RED→GREEN no único passe; sem Critical/Minor pendentes. Veja `04-final-review.md`.
- Regressões de aceite: estado final de qualificação sincronizado no mesmo commit do job; metadados de escopo manual não entram nos filtros do provedor e o escopo escolhido é respeitado. RED→GREEN observado.
- Ciclo integrado privado, com serviços, worker, journal e scheduler reais: leitura→rascunho→aprovação→três públicos→lista/par pausado→três cadências→rascunho→ativação→busca→qualificação pendente. Fixture `_test` `572ad97d-c71e-441d-ac8f-77635ea90747`: jobs de contexto `a2efc651-1d50-4c9b-9ebb-6ec195375fc3`, público `0fcd82c0-c162-4524-8ed9-f8f350a832a7`, cadência `2061a4ef-dcab-4b88-972a-262f99387a15`, qualificação `5739dcfe-feca-4d40-a9bf-93b3e583556a`. Três gerações, uma classificação e uma busca sintéticas; nenhuma proposta aplicada e nenhum envio.
- Concorrência de duas instâncias, replay após commit, recuperação de terminal, bloqueio de incerto, mudança de configuração/papel, quota sem órfão,150 pendentes sem novas chamadas no dia seguinte,501 elegíveis em lote500+backlog1 e dependência parcial cobertos por PG.
- Migrações014–020 aplicadas e repetidas nos bancos local e `_test`, checksums preservados. Cinco runtimes locais permaneceram pausados. `cadence_app` e `cadence_worker` sem superuser/BYPASSRLS. Nenhum volume apagado, budget ou allowlist OAuth alterado.
- Build de produção webpack passou; smoke anônimo54/54, com redirects e401 das APIs privadas, em `routes-04.json`. Sem chamadas externas no runner. Scheduler `--once` padrão saiu desabilitado sem claim.

## QA de navegador

Fluxo: criar automação manual→salvar pausada→recarregar→revisar ativação→bloqueios impedem confirmar→voltar sem criar job. URL `http://127.0.0.1:3210`, Chromium via MCP Chrome DevTools existente. Plugin Browser ausente; não foi instalado nenhum runner ou plugin. A sessão é isolada do Chrome autenticado do concorrente.

Workspace visual local `a801c8b3-727f-40a1-94b2-422a1a74ef34`, “QA · Marco04 · revisão visual” (nome na UI contém espaços em “Marco 04”). Uma lista/automação manual pausada, zero jobs. Owner/operador conferidos com mudança temporária exclusiva de papel nesse QA e restauração em finally. Operador sem Ativar/Executar uma vez; troca para outro workspace retirou o conteúdo QA e retorno preservou o objeto. Não houve ativação real.

| Verificação | Evidência |
|---|---|
| Identidade/página não vazia | Título Prometeus Cadence, h1 e controles no DOM |
| Overlay/console | Sem overlay; console sem warn/error relevante |
| Desktop1440×1000 | Sem overflow horizontal; formulário, listagem e modal |
| Mobile390×844 | Emulação real390, sem overflow; listagem e modal rolável |
| Interação | Salvou pausada, persistiu após reload, revisão bloqueada com botão desabilitado |
| Escopo/papel | Controles administrativos ausentes para operador; workspace anterior retirado ao trocar |

Capturas foram emitidas na conversa. A gravação em arquivo foi recusada pelo sandbox do servidor Chrome MCP, inclusive no workspace; não há link de arquivo inventado. Mudanças durante uma análise e respostas tardias têm cobertura de domínio/cliente; não foram demonstradas com uma inferência real no navegador. Propostas completas foram testadas em `_test`, não exibidas como uma chamada real no QA visual.

## Operação

1. `rtk npm run db:up`, `rtk npm run db:migrate` e aplicativo `rtk npm run dev` ou build/start.
2. Configure credenciais, perfis de fontes e cotas no servidor; selecione a LLM em Provedores de IA. Nunca envie chaves ao chat/Git.
3. Aprove o contexto/produto. Revise programação completa, volume e critérios. Um calendário legado sem data de referência exige edição antes de ativar.
4. Revise e confirme a ativação. Com `AUTOMATIONS_SCHEDULER_ENABLED=true`, execute `rtk npm run scheduler`; execute `rtk npm run worker` separadamente. Ambos encerram por SIGINT/SIGTERM. Diagnóstico de uma janela: `rtk npm run scheduler -- --once --workspace ID`.
5. Leia bloqueios/ocorrências na automação e detalhes em Execuções. Sem canal de mensagem neste marco. Reprocessamento manual exige nova seleção/revisão de uso; não apague atribuições para simular um retry.

Sem JEV, a convencional faz toda a IA. JEV só decide/ordena acompanhado de convencional com teste válido24h; contexto/prévia usam geração convencional. Expiração não dispara teste pago automático. Mudança de fonte, rota, contexto, produto ou papel exige nova revisão; pausa impede novas operações recorrentes, mas respostas já enviadas mantêm resultado/uso. Execução avulsa tem autorização própria e não muda o próximo horário; dependência ainda não pronta rejeita o avulso sem job/reserva persistente.

Custos monetários desconhecidos aparecem como desconhecidos; unidades reservadas não são preço real. Codex ChatGPT é somente local/autorizado. As três inferências reais03B já foram usadas, sem novo piloto04. Apify/Apollo/OpenRouter/OpenAI/Gemini reais e precisão empírica permanecem sem novo aceite neste marco.

Para interromper com segurança: pause pelo produto e pare scheduler/worker conforme o estado dos jobs. Preserve volume, journal e uso para reconciliação; rollback de código não deve remover tabelas/migrações aplicadas. Restore de backup precisa de procedimento próprio antes de qualquer operação destrutiva.

## Fechamento da revisão

Os calendários gerados recebem data de referência validada, mostrada e vinculada à revisão da seleção. A ativação exibe fonte/lista/filtros efetivos, deduplicação, módulos, critérios, dependência e versões aprovadas. Backlog dependente inclui inserts anteriores ainda não atribuídos, sem dispensar o término da busca correspondente. Última execução significa primeira claim real do worker, não horário agendado/enfileiramento. Reativação retira esperas antigas e começa nas novas janelas futuras.

Se acesso for removido durante uma chamada, uma função estreita salva recibo técnico e uso dentro da lease existente. Resultado não é publicado; administradores atuais podem inspecioná-lo no job. Runs remotos retornados continuam elegíveis ao cleanup já autorizado. Lease obsoleta continua exigindo reconciliação. Nenhuma segunda revisão ou piloto externo foi feito.
