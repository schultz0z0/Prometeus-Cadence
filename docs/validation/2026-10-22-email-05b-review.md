# Revisão independente final05B

Faixa revisada: `b84e44e..1db0226`. Um revisor com contexto novo (`gpt-6.1-sol`) fez a revisão em passagens, sem editar arquivos nem chamar provedores. A tentativa inicial com `gpt-6-astra` não iniciou por limite de uso; não produziu revisão ou achados. Houve uma revisão substantiva e uma rodada de correções por TDD, sem segunda revisão.

O revisor confirmou isolamento do OAuth, CAS/criptografia de tokens, DNS público fixado/TLS, preservação de incerteza sem replay, quota/barreiras SQL e compatibilidade das migrações. Não reportou Critical ou Minor. A avaliação inicial foi não integrar até corrigir quatro Important:

1. **Hold permanente de thread.** Não havia caminho para limpar `needs_review`. Corrigido com confirmação administrativa por conversa, revision/última mensagem, justificativa e auditoria imutável. A ação não inventa frescor nem consentimento. Regressão hold→revisão→recuperação/sync→resposta; tenant/role, histórico alterado, idempotência e novo hold cobertos.
2. **DSN sem referência original.** Headers da mensagem original em `text/rfc822-headers`/`message/rfc822` eram drenados. Extração agora limitada aos headers de8KiB, sem importar corpo, combinada com recipient/status. Conflitos/duplicidades permanecem em revisão. Testes MIME completos e MIME→ingest verificam hard/soft bounce e correlação exata.
3. **Mensagem grande travava Gmail.** MIME acima de2MiB causava erro antes do checkpoint. Agora usa metadata limitada para criar aviso visível, manter o hold e avançar o cursor duravelmente. Regressões incluem2MiB+1, JSON acima do teto de4MiB e nova sincronização sem repetir a mensagem grande.
4. **Limite agregado de conteúdo.** Texto, assinatura, assunto e footer passavam separados e podiam violar o limite de preview armazenado. A revisão de publicação/teste valida o resultado completo em bytes antes de confirmar. Casos ASCII/Unicode foram observados falhando e depois passando com bloqueio correto; nenhuma publicação inválida é criada.

Os quatro achados foram aceitos como Important por efeito no usuário e corrigidos em uma rodada. Evidência específica:11/11 Gmail/MIME e28/28 integrações mail-http/mail-inbound/mail-sync/multichannel-publication antes da suíte completa pós-correção. Números finais ficam no [relatório05B](2026-10-21-email-05b.md).

## Itens reservados pelo revisor e decisões

- Contas reais Gmail/SMTP, entrega, quotas e revogação ficam no piloto final escolhido pelo usuário. Custo: possíveis restrições específicas ainda precisam ser observadas.
- Verificação pública OAuth/avaliação de segurança, DKIM/reputação/DNS ficam como pré-requisitos de lançamento. Custo: aprovação pública pode limitar a data de lançamento.
- QA renderizada com contas populadas e mobile permanece pendente. Custo: problemas visuais nesses estados ainda podem aparecer.
- Importação histórica e Enviados sem correlação ficam excluídos; recuperação é limitada. Custo: conversas antigas independentes não aparecem no app.
- Microsoft OAuth, Pub/Sub, MX próprio, anexos completos, HTML arbitrário e tracking ficam fora05B. Custo: exigem entrega posterior se necessários.
- Throttle distribuído de unsubscribe fica para o ingresso público; a implementação atual é por processo, com supressão atômica no banco. Custo: múltiplas instâncias precisam de limite agregado no edge.

Registro integral das decisões e seus custos: [decisões05B](2026-10-21-email-05b-decisions.md). Não há Minor adiado nesta revisão.
