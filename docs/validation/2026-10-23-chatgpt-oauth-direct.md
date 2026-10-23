# Validação — ChatGPT OAuth direto

Data: 23/10/2026. Base: `205df79`. Desenho aprovado para implementação direta: `docs/superpowers/specs/2026-10-23-chatgpt-oauth-direct-design.md`.

## Evidência automatizada

- `npm test`: 227 testes, 227 aprovados.
- `npm run test:integration -- chatgpt-oauth ai-settings ai-routing-pipeline ai-probe planning-pipeline planning-confirmation client`: 48 testes, 48 aprovados, em banco descartável isolado.
- `npm run typecheck`: aprovado.
- `npm run build`: compilação de produção aprovada; rotas OAuth e configurações incluídas.
- `git diff --check`: aprovado.
- Migração nova 058 aplicada no banco local, sem alterar migrações anteriores ou conceder privilégios novos.

Fixtures verificam PKCE/state/nonce novos; assinatura, emissor, audiência, nonce e expiração do ID token; retorno vinculado à sessão/workspace/revisão; replay, origem, operador e modo hospedado rejeitados; permissões insuficientes e catálogo indisponível não habilitam inferência; tokens cifrados e DTOs sem segredos; refresh concorrente único e revogação.

O teste de trava usa processos Node filhos reais: encerra o proprietário da trava e verifica que dois concorrentes entram um de cada vez. Uma intenção de refresh interrompida exige reconexão sem repetir o refresh token antigo.

Fixtures Responses verificam evento terminal, saída JSON e erro tardio de cota, sem reenvio ou troca de provedor. O adaptador OAuth executa qualificação, resumo, leitura de contexto, propostas de público, opções de cadência e prévia de mensagem sem CLI. Os pipelines verificam reserva/journal/publicação e bloqueio do JEV sem acompanhante testado; contatos não são alterados pela mera geração da proposta.

## Revisão independente

O revisor encontrou dois problemas na antiga trava por arquivo: recuperação concorrente podia remover uma trava substituta; queda durante a escrita podia deixar uma trava vazia permanente. Ambos foram corrigidos substituindo a trava por exclusão transacional do PostgreSQL e registrando intenção de refresh antes da chamada. A segunda revisão confirmou as correções e não encontrou pendências importantes. O revisor fez análise estática; os testes foram executados pelo implementador.

## Interface no navegador

Playwright Core com Chrome headless, aproveitando a dependência já instalada; o Browser plugin não estava disponível. Teste autenticado no workspace local, sem salvar política ou navegar para a autorização externa: botão de conexão habilitado, opção OAuth presente, rascunho de roteamento preservado após atualização automática, status local desconectado disponível, nenhum erro de página. Capturas desktop 1440 px e mobile 390 px inspecionadas; sem overflow horizontal no mobile. Artefatos locais ignorados em `.runtime/chatgpt-oauth-desktop.png` e `.runtime/chatgpt-oauth-mobile.png`.

## Piloto e limites

Nenhuma inferência real ChatGPT, chamada paga ou autorização de conta foi executada nesta entrega. O usuário deve concluir o consentimento no navegador e confirmar o teste sintético no app. As permissões, modelos e limites efetivamente concedidos pela conta serão validados nesse piloto; fixtures não demonstram acesso à conta real. O modo comercial hospedado permanece desabilitado até habilitação própria da OpenAI.

Após a atualização, o supervisor local foi reiniciado com os quatro serviços vivos e sem falhas: dispatch, sync, jobs e scheduler.
