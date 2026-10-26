# 06A-P e fechamento visual conhecido — implementação

**Goal:** completar entrada pública e ativação da conta com persistência real e fechar a forma do assistente lateral. Execução autorizada pelo usuário em26/10/2026.
**Spec:** `2026-10-26-prometeus-cadence-parity-closure.md`, seções06A-P/06A-V. A referência visual é o estado observado em26/10; estados pagos não observados permanecem assim.
**Architecture:** Better Auth existente continua responsável por credenciais, verificação e tokens. Metadados de cadastro são validados no servidor e gravados junto ao usuário; campos de aceite não são atualizáveis pela API pública de perfil. Google encaminha novos usuários para completar os mesmos dados. Destinos pós-login são restritos a rotas de entrada conhecidas.
**Tech stack:** Next16.4.2, React19, Better Auth1.7.12, PostgreSQL, Node test runner e Playwright CLI.

## Restrições globais

- Preservar alterações anteriores e branch de trabalho existente; não fazer commit amplo, reset, compra, envio externo nem escrita na referência.
- Trial7 dias, sem cartão/cobrança automática e sem ativação implícita ao cadastrar.
- Documentos próprios provisórios identificados como homologação; nunca copiar textos legais da referência. Substituição comercial pendente de textos definitivos do responsável.
- Assistente conversacional operacional permanece06F: fechar geometria/abertura/fechamento e atalhos reais agora, comunicar indisponibilidade do chat sem simular respostas.
- E-mails capturados apenas no SMTP local; testes de domínio em banco isolado.

## Task1: contrato de cadastro e persistência

Arquivos: `src/domain/registration.ts`, `src/domain/legal-documents.ts`, `src/server/auth/auth.ts`, `db/migrations/074-registration.sql`, `tests/registration.test.ts`, `tests/integration/auth.test.ts`, helpers de integração.

Interfaces: entrada `registration: {phone, accepted, termsVersion, privacyVersion}`; saída canônica e instante gerado pelo servidor. Campos adicionais protegidos e gate de conclusão para novos cadastros sociais. Usuários anteriores preservados.

1. RED: rejeitar telefone inválido, aceite ausente/desatualizado, destinos externos e combinações de intenção não oferecidas. Integração: signup incompleto rejeitado, cadastro válido persiste e não cria assinatura; aceite não forjável por update-user.
2. GREEN: implementar validação/hook atômico, migração aditiva e perfil complementar autenticado.
3. Verificar testes focados e migrations. Esperado: telefone/versões/horário persistidos, senha/token privados e nenhum efeito financeiro.

## Task2: jornada pública e estados

Arquivos: `src/modules/auth/*`, `src/app/{login,register,verify-email,reset-password,accept-invitation,onboarding}/**`, `src/app/api/registration/route.ts`, `src/server/auth/registration.ts`, `src/app/registration-reference.css`.

Interfaces: contrato daTask1, intenção de plano validada, convite preservado após login/verificação. API de conclusão não altera senha/email/plano; sessão verificada obrigatória. Documentos acessíveis em popup e URL própria com versão.

1. Telefone, senhas lado a lado, checkbox e documentos; loading/falha/sucesso, reenvio e token inválido/expirado.
2. Encaminhar login/convites sem open redirect; logout real para trocar conta; convite expirado/revogado/email divergente exibidos com resposta autoritativa após autenticação.
3. Verificação ponta a ponta local com e-mail capturado e token de uso único; desktop/mobile sem overflow. Nenhuma assinatura ativada pelo fluxo.

## Task3: assistente lateral

Arquivos: `src/components/shell/{app-shell,assistant-panel}.tsx`, CSS dedicado importado pelo layout.

Interfaces: shell abre painel; rotas existentes de IA/contexto são destinos reais. Dialog lateral acessível, foco/escape/retorno ao gatilho, responsivo. Composer não operacional identificado até06F.

Verificar geometria em viewport correspondente, abertura/fechamento e navegação; não escrever testes que apenas espelhem CSS.

## Task4: validação e registro

Executar unitários, integrações relevantes, typecheck e build; migrar banco local e reiniciar app sem terminal visível. Comparar screenshots mascaradas desktop/mobile e documentar estados exercitados, contratos próprios e limites de observação em `docs/validation/06-entry.md`. Revisão final única com contexto novo; corrigir achados materiais. Próximo marco depois deste pacote:06A-H em Stripe sandbox.

**Review focus:** aceites não forjáveis, convites/destinos, novo Google sem bypass, preservação de usuário legado, ausência de ativação/cobrança/envio externo, acessibilidade e fidelidade declarada com evidência.
