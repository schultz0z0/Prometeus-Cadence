# EV-288 — Google Agenda 07C.2c

[obs EV-288] Sessão s26, 03/11/2026.
- **Grid de Apps:** igual ao EV-204, com FunnelsFlow, Sheets, Apollo e MeetFlow. Não há cartão de agenda.
- **Agenda na referência:** aparece só no Agente SDR ("Agenda e registra no CRM", EV-256). A tela de configuração dela não foi observada.
- **Página local:** `/settings/apps/google-calendar` segue o padrão da página Sheets (EV-258/EV-287).
- **Referência:** nada foi escrito nem chamado.

Local: identidade descartável L-035 (removed), com uma fixture de conexão sem tokens reais.
- **Sem cliente OAuth:** aviso de "não configurado".
- **Disponibilidade:** o envio falhou ao ler o acesso, sem chamada ao Google, e manteve o rascunho.
- **Conectada:** resumo das regras. "Ver horários livres" levou à atenção, com "Reconectar".
- **375 px:** sem overflow.

Limites: o consentimento Google real e a criação de eventos numa agenda real não foram exercidos; estão cobertos por testes com o Google simulado.

[Relatório](../../../validation/07c2c-google-calendar.md) e [revisão](../../../validation/07c2c-google-calendar-review.md).
