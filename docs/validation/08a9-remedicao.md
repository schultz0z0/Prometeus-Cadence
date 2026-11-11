# 08A.9 — Remedição no código atual

Em 10/11/2026, depois do 06B.7, da correção do OAuth, do esquema de decisores e da descoberta de CNPJ (commit `41afad0`), as medições globais foram regeradas sem alteração de código durante a execução.

| Medição | Resultado |
| --- | --- |
| Jornadas clicadas (`tests/manual/full-journeys.mjs`) | 27 de 27, resíduo zero |
| Varredura de rotas (`tests/manual/route-sweep.mjs`) | 584 de 584 visitas, isolamento entre duas contas confirmado, resíduo zero |
| Integração completa | 704 testes: 699 passaram, 5 pulados, nenhuma falha |
| Unitários | 465 de 465 |
| Auditor (`scripts/audit-release-coverage.mjs`) | **117 de 138**, aceite integral negado |

O auditor voltou de 8 para 117 porque os relatórios globais estão outra vez no hash do código atual. Os 21 itens restantes:

- **17 bloqueados por dependência externa**: envio real por canal próprio, LinkedIn/Unipile, piloto SDR, CRM, MCP e webhooks com URL pública, Google Agenda e Sheets, SMTP público e login Google.
- **4 pendentes locais**: demais popups pelo mesmo componente; administrador e demais áreas por papel; rede nos demais formulários, leituras e foco após erro; comparação visual com a referência por área.

Quatro estados da referência seguem desconhecidos, com prova local: assinatura ativa, pagamento pendente, cancelada e renovação cancelada.

O item "módulo: pesquisa e enriquecimento" continua bloqueado no registro. A homologação real por módulo já executou busca e IA reais com autorização do operador, mas ainda sem um decisor com contato entregue. [Homologação por módulo](06b6e-homologacao-por-modulo.md)

A comparação visual com o CadenceFlow ao vivo não foi refeita nesta remedição.

## Remedição de 11/11/2026

Depois da homologação por módulo, das jornadas novas de popups, papéis e rede e das correções do Enriquecedor (commit `d0099e0`), as medições foram regeradas sem alteração de código durante a execução.

| Medição | Resultado |
| --- | --- |
| Jornadas clicadas | todas verdes, 151 passos, resíduo zero |
| Varredura de rotas | 584 de 584, isolamento entre contas confirmado, resíduo zero |
| Auditor | **119 de 138**, aceite integral negado |

Os dois itens que passaram são "administrador e demais áreas por papel" (jornada `roles-matrix`) e "rede nos demais formulários, leituras e foco após erro" (jornada `network-forms`). Seguem pendentes os popups que dependem de conexão externa ou de execução em estado específico, e a comparação visual por área, que é aceite do usuário. Os 17 bloqueios externos não mudaram.
