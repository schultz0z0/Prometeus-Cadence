# CadenceFlow — investigação para reconstrução

Data: 20/10/2026. Projeto: Prometeus Cadence.

## Estado real do trabalho

A pasta estava vazia no início. Foram produzidos um levantamento do produto, referências visuais, análise estática do cliente com REA e uma especificação proposta. **A aplicação ainda não foi implementada.** A reprodução integral permanece pendente; este levantamento não comprova equivalência do backend.

- [Levantamento e evidências](FINDINGS.md)
- [Rotas e cobertura](SURFACE-MAP.md)
- [Especificação proposta](../superpowers/specs/2026-10-20-prometeus-cadence-design.md)
- `evidence/rea-public-login.json`: captura REA do login público, em navegador temporário sem autenticação.
- `evidence/rea-client-summary.json`: resumo da análise de 29 arquivos JavaScript.
- `evidence/rea-evidence-bundle.json`: evidências completas exportadas pelo REA; arquivo grande, mantido localmente.
- `artifacts/client/`: arquivos públicos entregues pelo frontend, preservados somente como evidência, sem executá-los como produto novo.
- `screenshots/`: cópias dos 18 prints fornecidos pelo usuário; a ordem é preservada no manifesto.

## Limites da investigação

A sessão autenticada do usuário foi observada pelo conector do Chrome. O chrome-devtools MCP disponível abre um navegador isolado, sem essa sessão. O Chrome do usuário não estava exposto por um endpoint CDP; não foi reconfigurado. Por isso o REA foi usado para captura pública e análise dos artefatos de cliente; não se atribui ao REA a observação autenticada feita pelo conector do navegador.

Não foram ativados testes, contratos ou pagamentos, conectados canais, criados novos registros persistentes nem iniciadas extrações, qualificações ou mensagens. Foram abertos formulários e preenchidos campos temporários de inspeção, abandonados sem salvar. As listas e automações já existentes eram anteriores à investigação.

## Acervo O Setup

O servidor `setup-agent` consta da configuração local com `search_resources`, `get_resource`, `list_by_kind` e `recommend_for_project`, mas nenhuma dessas ferramentas foi exposta nesta sessão. Uma tentativa de consultar `tools/list` no endpoint configurado retornou **HTTP 401**. Portanto, a consulta ao catálogo **não foi concluída**; não se afirma que inexiste recurso adequado.

Foi reaproveitado o REA já instalado e explicitamente solicitado pelo usuário. Não foram criados ou instalados plugins, skills ou servidores MCP equivalentes. Antes de recomendar novas ferramentas ou recursos desse tipo, retomar a consulta autenticada ao acervo.

## Continuidade

Revisar a especificação proposta antes de iniciar o código. A skill `superpowers:brainstorming` exige revisão da especificação escrita antes da implementação; o plano detalhado será o próximo artefato depois dessa revisão. Não é necessário repetir a investigação inicial para continuar.
