# Correção do retorno Gmail OAuth local

## Falha reproduzida

Após consentimento Google, o callback retornava para Configurações com oauth=failed e a caixa permanecia em authorization_required. Nas duas tentativas observadas, o estado OAuth ainda não havia sido consumido: a rejeição ocorria antes da troca do código.

O NextRequest do Next.js 16.4.2 normaliza a origem de 127.0.0.1 para localhost, mantendo o cabeçalho Host original. A comparação estrita com o redirect registrado em 127.0.0.1 rejeitava essa URL com status 422. A regressão com NextRequest real falhou antes da correção e passou após ela.

## Alteração

A fronteira HTTP restaura exclusivamente o endereço de loopback registrado quando Host, caminho, protocolo e porta correspondem exatamente. Não confia em cabeçalhos forwarded. Origens externas, aliases em produção, caminhos e portas divergentes continuam bloqueados. Sessão, workspace, estado de uso único, PKCE e revisão da caixa seguem validados no serviço existente.

O app mostra o resultado do retorno Google. Uma autorização salva não é apresentada como caixa pronta: a sincronização inicial continua necessária. O callback foi excluído do log de URLs do Next, e o diagnóstico registra apenas etapa, status e presença dos parâmetros, sem códigos, estado, tokens ou cookies.

## Evidência

- Testes unitários: 212/212 aprovados, incluindo normalização e feedback seguro.
- Integrações mail-http, mail-oauth, auth e tenancy: 20/20 aprovadas.
- TypeScript: tsc --noEmit aprovado.
- Build de produção webpack aprovado, usando cópia temporária no mesmo volume com ambiente herdado, sem interromper o servidor local. O primeiro ensaio isolado falhou por montagem entre volumes e o segundo por ausência do ambiente; ambos eram problemas da cópia de validação. O ensaio final compilou, verificou tipos e gerou todas as páginas.
- Revisão independente somente leitura: sem achados Critical, Important ou Minor; apto a integrar. O revisor executou 2 testes do callback e diff --check.
- Piloto real: usuário repetiu o consentimento Google e confirmou autorização salva. Banco confirmou revisão 2, credenciais verificadas e endereço da caixa correto. A sincronização manual completou sem erro ou gap; limites ainda não configurados mantêm a caixa em verifying. Nenhum e-mail foi enviado. A revisão independente não executou consentimento real.

Sem migração de banco. Nenhuma credencial foi adicionada ao Git. Sincronizadores e disparadores não foram ativados por esta correção.
