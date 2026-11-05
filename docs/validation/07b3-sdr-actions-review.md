# Revisão final — 07B.3

04/11/2026. A revisão foi feita por um subagente independente, somente leitura, sobre a mudança antes do commit. Não encontrou Critical. Encontrou cinco High, doze Medium e oito Low. As regressões dos achados de servidor falhavam antes da correção (migração 110b).

| Achado | Correção | Regressão |
|---|---|---|
| High H1: a evidência de consentimento autorizava mais do que a pessoa aprovou e durava até 30 dias | Rascunho original fora da janela é recusado; os 2 retornos encerram o follow-up; evidência residual vale no máximo 1 dia; retirada ou assunção apagam na hora. Continua sendo evidência `service` do contato, como a tela de consentimento já faz | Retirada apaga a evidência |
| High H2: operador criava consentimento com qualquer trecho | Só proprietário ou administrador (`consents.manage`), e a citação precisa ser a proposta pela IA naquele turno, com pelo menos 10 caracteres na proposta | Operador 403; fragmento e turno sem proposta 422; nenhuma evidência |
| High H3: na Meta o follow-up nunca gerava retorno, mas era oferecido | Registro recusado (`SDR_FOLLOWUP_META`), oferta oculta e limite dito nas configurações | Meta: 409 e `followupAvailable` falso |
| High H4: 24 h não valiam na hora de enviar | A aprovação do retorno confere a última mensagem enviada, e aprovar recalcula o próximo retorno | Saída recente: 409 `SDR_FOLLOWUP_TOO_SOON` |
| High H5: encerrar não derrubava o retorno aberto | Encerrar descarta o rascunho e libera a unidade; retorno sem autorização ativa não é elegível | Retirada: `superseded`, nada reservado; retry recusado |
| Medium M1: tentativa gasta sem rascunho | Conta só com rascunho criado; bloqueado tenta de novo em 24 h | Sem franquia: 0 tentativas; depois o retorno sai |
| Medium M2: estado não relido sob a trava | Releitura com tentativas e prazo; retirada toma a trava | Coberto pela leitura do código |
| Medium M3: varredura e candidatos podiam travar | Varredura só com motivo de parada; bloqueios antes do `LIMIT` | Coberto pela leitura do código |
| Medium M4: reserva `prepared` ou passada travava a conversa | "Verificar de novo" também para `prepared`; reunião passada não bloqueia | Reunião passada: sem bloqueio |
| Medium M5: "Verificar" podia criar em horário passado ou com opt-out | Recusado nesses casos; reserva resolvida responde sem chamar o Google | Horário passado: 409; repetição não cria evento |
| Medium M6: cancelar sem confirmação | Confirmação na tela | Coberto pela leitura do código |
| Medium M7: rascunho podia citar reunião cancelada | Aviso quando o texto inserido não vale mais; horário com fuso da agenda; a IA recebe a reunião marcada | Conferido na leitura e no navegador |
| Medium M8: retenção não alcançava a citação | Gatilho limpa proposta, citação e evidência | Mensagem apagada: nada resta |
| Medium M9: workspace sem membro abortava o ciclo | Mesmo filtro dos turnos normais | Coberto pela leitura do código |
| Medium M10: esquema com `null` em enum não verificado no Gemini | `none` e texto vazio, aceitos em qualquer provedor | Teste do parser |
| Medium M11: follow-up não parava com o agente fora | Motivo `AGENT_OFF` na varredura | Coberto pela leitura do código |
| Medium M12: lacunas de teste | Verificação, papel, retirada com retorno pendente, bloqueio e removido adicionados | Teste da revisão |
| Low L1, L3, L4, L5, L6, L7 | Limite de dias no SQL; abort preso à conversa e ao autor; revisão limpa ao mudar consentimento; horários recarregam depois de erro; texto "agenda Google conectada ao workspace"; citação longa descartada | Parser e leitura do código |
| Low L2: novo registro zerava as tentativas | Recusado quando já houve retorno para a mensagem | 409 |
| Low L8: rejeitar um retorno não parava o próximo | Rejeitar encerra o follow-up | Coberto pela leitura do código |

## Aceitos sem mudança

- **H1 (parte):** a evidência `service` vale para o contato naquele número enquanto existir, como já acontece com a tela de consentimento. Por isso o registro ficou restrito a quem pode gerir consentimentos.
- **M4 (b):** reserva de uma conta Google desconectada precisa ser apagada direto na agenda, como a mensagem do serviço já orienta.
- **M5 (corrida):** "Verificar" não renova a reserva local. Dois pedidos simultâneos depois de 10 minutos ainda podem deixar um evento sobrando; o risco só aparece depois de uma falha de resposta do Google.
