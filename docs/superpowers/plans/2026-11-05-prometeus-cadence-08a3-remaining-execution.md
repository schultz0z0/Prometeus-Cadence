# 08A.3 — Pendências locais e comparação visual

05/11/2026. Última parte local do [08A](2026-10-27-prometeus-cadence-08a-final-regression.md), depois do [08A.2](2026-11-05-prometeus-cadence-08a2-journeys-execution.md). Ao final, o usuário continua o desenvolvimento em outra plataforma, e esta fase entrega o prompt de continuação.

## Limites de segurança

Os mesmos do 08A.2: navegador sem acesso a outros hosts, contas sem canal, sem fornecedor pago, sem confirmação no Stripe, limpeza por id. Além disso:
- **Execuções:** só `failed` e `partial` no banco, que os workers não pegam. "Em andamento" é simulado na resposta da API, porque um `running` real poderia ser pego por um worker depois do fim da reserva e chamar a Apify.
- **Referência:** a comparação usa capturas já guardadas. O CadenceFlow não é acessado nem alterado.

## O que entra

- **Jornadas:** prospecção local, execução da retenção de texto, editar e salvar cadência, concluir o onboarding e estados de execução.
- **Transversais:** popups por módulo, administrador e operador em outras áreas, teclado em mais telas, rede em mais formulários e leituras, foco após erro e relatórios com dados.
- **Módulos:** cada um dos 8 pendentes é conferido contra o próprio relatório. Prova existente vira aprovação com o relatório citado; efeito externo não homologado vira bloqueio, sem aprovação.
- **Comparação visual:** captura local no mesmo viewport das capturas de referência, lado a lado, com uma linha por área e veredito. Diferença corrigível é corrigida; a que ficar aberta é listada, e o item não vira aprovado sem o aceite do usuário.

## Regra do registro

Nenhum item novo aprova por status digitado quando pode ser decidido por uma rodada. Item que não fechar fica pendente ou bloqueado, com o motivo.
