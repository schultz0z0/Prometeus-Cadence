# Revisão final do 06D.2

Uma revisão independente da branch inteira, base `c655e71` e implementação `529ee8e`, retomada após a primeira tentativa encerrar por limite de uso sem produzir achados. Revisor somente leitura, sem agentes adicionais; parecer: corrigir dois achados importantes. Nenhum crítico.

## Correções importantes

1. **Sessão revogada/expirada durante observação:** membership e conexão já eram revalidados; a sessão passou a ser conferida e bloqueada somente durante as duas transações curtas, sem manter lock durante I/O. A função restrita da migração086a consulta apenas a sessão do usuário corrente; não concede leitura de tabelas de autenticação ao papel de aplicação. Sessão revogada/expirada ou de outro usuário retorna401; workspace alterado retorna409, sem diário/comando novo. Recibo técnico existente é preservado.
2. **Domínio de e-mail em maiúsculas:** o popup usa o destinatário do snapshot revisado e o serviço aplica a normalização já usada no envio. `Contact@EXAMPLE.NET` corresponde a `Contact@example.net`; `contact@example.net` continua sendo outra identidade. Nenhuma normalização silenciosa do local-part.

Regressões no arquivo de integração06D.2: exclusão/expiração/troca de workspace durante `observe`, substituição da sessão por outro usuário e domínio equivalente com local-part distinto. O primeiro ensaio de sessão cruzou uma mudança de código durante inicialização do runner e falhou por migração ausente; ele não foi contado como prova da regra. O ensaio sem o guard, com restauração garantida em `finally`, reproduziu quatro **Missing expected rejection**, depois todos passaram com o guard. E-mail reproduziu409 indevido, depois passou. Suíte focada pós-correções:13/13.

## Menor adiado

- Uma falha inicial da consulta pode continuar visível no popup mesmo após um polling bem-sucedido atualizar os comprovantes. Não altera envio, recibo ou autorização. Não foi incluído na única rodada de correções importantes; manter no acompanhamento de UX/06F.

## Decisões sobre limites da revisão

- Entrega externa em contas próprias requer piloto separado com destinatário e ações explicitamente autorizados. Não executar mensagens automaticamente; risco residual: diferenças específicas do provedor ainda podem aparecer nesse piloto.
- Estados conectados/pagos da referência permanecem não observados, conforme escolha do operador. Cenários controlados não provam paridade; risco residual: diferenças visuais desses estados.
- Produção pública, carga e recuperação operacional continuam nos gates08B. Os testes locais não substituem esses gates; risco residual: condições do deploy ainda não exercitadas.

Sem segunda revisão: os achados importantes são verificados por regressões e pela suíte completa após a única rodada de correções. Resultados finais em [verification.json](evidence/06d2-channel-operation/verification.json).
