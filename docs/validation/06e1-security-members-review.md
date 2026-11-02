# Revisão final —06E.1

02/11/2026. Uma revisão independente em contexto novo por Claude Opus5.5, intervalo imutável786ef97..515ed06 (servidor, migrações091/091a, HTTP e UI). Sem Critical; um Important corrigido numa passagem RED→GREEN, sem segunda revisão.

| Achado Important | Correção/regressão | Evidência observada |
|---|---|---|
| Ações secundárias do formulário de código submetiam o código | `type="button"` em "Recomeçar pareamento", "Usar código de recuperação/aplicativo", "Voltar para o login", "Voltar ao pareamento", "Descartar pareamento" e "Concluir" | Sem o tipo, o botão HTML é submit: com seis dígitos digitados, "Recomeçar pareamento" enviava `verify` e ativava o autenticador; "Voltar para o login" enviava o código em paralelo ao logout. Regressão estática em `tests/06e1-security-members.test.ts`: falhou antes (`second-factor.tsx`), passou depois4/4 |

Review Focus conferido no código: código errado/expirado/repetido (`totp_use` + desafio com epoch/fingerprint), backup concorrente serializado por lock do usuário com endpoints nativos `/api/auth/two-factor/*` bloqueados, sessão pendente bloqueada em `requireIdentity`, `handleAuthRequest` e `app.second_factor_allowed` na transação `cadence_app`; troca de senha/revogação apagam sessões e desafios (trigger + wrapper); último owner protegido no serviço e por trigger com advisory lock; idempotência por `membership_request`; administração do workspace não alcança a plataforma.

Verificação após a correção: 367/367 unitários; 466/466 integrações; build e tipos exit0; `git diff --check` limpo. A correção não foi reexercitada em navegador nesta passagem: é semântica HTML do botão, coberta pela regressão estática; QA visual anterior permanece válida para layout.

## Menores adiados

Owner08A:

1. `disableTotp` consome o código TOTP antes de validar a senha; senha errada queima o código atual e obriga esperar o próximo período. Sem impacto de segurança.
2. A regressão do botão é textual (regex sobre o fonte), não renderização; um `Button` com `type` dinâmico não seria detectado.

Aceite local/controlado. Diferenças com a referência (código por e-mail, confiança30dias, senha8) e gates de produção seguem no relatório. Próximo06E.2, sem merge/push/deploy nesta execução.
