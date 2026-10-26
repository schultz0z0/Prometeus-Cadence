# Coverage

Atualização s04,26/10: esta tabela nasceu como fila de baseline. A evidência posterior está consolidada em [REPORT](../REPORT.md) e [EV-265](../evidence/EV-265-validation-results.json). Houve100 visitas locais desktop/mobile e28 overlays sem falhas, além de verificações profundas de cadastro, lead, wizard e editor. As células seguem parciais porque as famílias incluem estados não observados/indisponíveis; não significam que os respectivos estados iniciais continuem sem inspeção. Não há aceite integral da família nem da persistência da referência.

Valores: todo, partial, done, blocked, n/a. Esta matriz acompanha evidência demonstrada, não intenção/quantidade de componentes. **Nenhuma linha tem aceite integral.** Capturas adicionais em evidence/ devem ser inspecionadas antes de elevar células. O inventário estático de rotas está completo dentro da busca declarada; a auditoria visual de rotas/estados continua parcial.

| Feature | Anatomy | States | Interactions | Rules | Data | Network | Keyboard and a11y | Persistence | Design | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Shell e navegação | partial | partial | partial | partial | partial | n/a | todo | n/a | partial | Base nova; overlays/mobile/dark/tamanho/foco pendentes |
| Dashboard/onboarding | partial | partial | partial | partial | partial | blocked | todo | blocked | partial | dashboard-ref; FirstSteps baseline divergente; tours pendentes |
| Contatos/detalhes/import | partial | partial | partial | partial | partial | blocked | todo | blocked | partial | Referência anterior; import subrota/detalhes pendentes |
| Gerador por fonte | partial | partial | partial | partial | partial | blocked | todo | blocked | partial | Quatro fontes e todos resultados/revisões requerem visita |
| Qualificação/enriquecimento | partial | partial | partial | partial | partial | blocked | todo | blocked | partial | Consumo/resultado/conectado não comprovados |
| Cadências/editor/pipeline | partial | partial | partial | partial | partial | blocked | todo | blocked | partial |5 tabs/editor/publicação; criação4 modos e steps |
| Templates | partial | partial | partial | partial | partial | blocked | todo | blocked | partial | CRUD/preview/aprovação/erros pendentes |
| Automações/wizards/runtime | partial | partial | partial | partial | partial | blocked | todo | blocked | partial | Wizard anterior não avançou; não inventar passos observados |
| Execuções/detalhe | partial | partial | partial | partial | partial | blocked | todo | blocked | partial | Estado por tipo de job; demo não comprova real |
| Email/WhatsApp inbox | partial | partial | partial | partial | partial | blocked | todo | blocked | partial | /inbox baseline canal divergente; conectado/reply pendentes |
| Relatórios4 tabs | partial | partial | partial | partial | partial | blocked | todo | blocked | partial | Performance baseline compartilhava overview |
| Settings conta/contexto | partial | partial | partial | partial | partial | blocked | todo | blocked | partial | JSONs novos; local equivalente ainda precisa aceite por estado |
| Settings notificações/membros/security | partial | partial | partial | partial | partial | blocked | todo | blocked | partial | JSONs novos; categorias/2FA/sessões/permissões |
| Settings MCP/dados/privacy/webhooks | partial | partial | partial | partial | partial | blocked | todo | blocked | partial | Baseline placeholders; correção não equivale a operação integrada |
| Settings canais/limites | partial | partial | partial | partial | partial | blocked | todo | blocked | partial | OAuth/QR/retorno/falhas/conectados; OpenWA gerenciado |
| Settings apps/subrotas | partial | partial | partial | partial | partial | blocked | todo | blocked | partial | Cinco telas de referência; catchall baseline descartava subsegmentos |
| Plano/billing | partial | partial | partial | partial | partial | blocked | todo | blocked | partial | Preservar aprovado; catálogo não comprova compra/fatura/política |
| LinkedIn por seção | partial | partial | partial | partial | partial | blocked | todo | blocked | partial |8 seções e nova campanha; baseline shell comum; novas capturas em andamento |
| SDR | partial | partial | blocked | partial | partial | blocked | todo | blocked | partial | Pro gate observado anteriormente; operacional não exercitado |
| Auth/workspace/convite/tokens | todo | todo | todo | partial | todo | blocked | todo | blocked | todo | Fonte local inventariada; sem referência dedicada no índice anterior |
| Responsive/dark/keyboard/failure | todo | todo | todo | partial | todo | n/a | todo | n/a | todo | Necessário por família; desktop base não aceita variações |

Network/Persistence blocked significa que o escopo L4 não produziu evidência de transações autenticadas/persistidas na referência. Não impede correções locais autorizadas; impede afirmar paridade operacional total.
