# EV-280 — Segurança e membros06E.1

[obs EV-280] Sessão s18,30/10/2026. ReferênciaL4: Segurança, Membros, login público e reset sem token em1920×855,390×844 e320×844. Convite público sem sessão redirecionou ao login. Quinze capturas mascaradas da referência. Inspeção passiva REA:ev_3d6ed534d816f2604cac5156d93cf1cd75de82bd4dc1b9df459011d1d3124d60. Nenhuma mutação, ativação ou envio na referência.

Local:62capturas mascaradas, pareamento TOTP, login desafiado/backup, revogação/desativação/senha, convites/assentos/papéis/conflito e remoção. Banco real local com identidades descartáveis; confirmação inicial de e-mail feita por fixtureSQL, não comprova entrega pública.19integrações focadas e366unitários;465integrações amplas passaram antes da última regressão de validade do convite, que passou adicionalmente focada. Revisão final concluída em02/11 (ver fechamento abaixo).

L026removed: dois usuários próprios, workspace, fatores, desafios, convites, sessões e projeções técnicas removidos por IDs exatos. L027restored: captura final somente leitura com QA dedicada anterior; apenas a nova sessão foi encerrada, dados/sessões anteriores preservados. Zero chamadas pagas ou envios externos.

Limites: QR/backup/convite válido e múltiplos membros da referência não exercitados; GoogleOAuth pendente testado com estado sintético, sem nova autorização real; texto da referência sobre emailOTP/confiança30dias não equivale à entrega local. Implementação expõe sessões reais e desafio2FA, sem prometer bypass inexistente. Senha12caracteres/nova entrada após troca são contrato local; referência anuncia8/manutenção da sessão. Paridade100% não aceita.

[Relatório e evidências](../../../validation/06e1-security-members.md). Fechamento02/11: revisão independente com um Important corrigido (botões secundários submetiam o formulário de código) e dois menores→08A; 466/466 integrações; [revisão](../../../validation/06e1-security-members-review.md).
