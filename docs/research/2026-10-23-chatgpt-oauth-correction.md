# ChatGPT OAuth como LLM convencional

## Correção de requisito

O usuário esclareceu em 23/10/2026: quer autorização ChatGPT OAuth na plataforma para utilizar modelos e cota da conta, sem exigir Codex CLI instalado. O adaptador `codex-local` implementado anteriormente não satisfaz esse requisito. Ele pode continuar sendo uma opção local separada, mas não deve ser apresentado como implementação do OAuth direto.

O roteamento permanece: LLM convencional completa sozinha quando JEV não está conectado; JEV somente acompanhado da LLM convencional. OAuth é um método de autenticação do provedor convencional, não uma nova permissão de publicação/envio.

## Referência local autorizada

O usuário forneceu `D:/Projetos SaaS/Projetos Pessoais/AionUI` para estudo, sem alterações. Arquivos inspecionados: `packages/web-host/src/chatgpt-oauth.ts`, testes unitários OAuth e referências `ClientFactory.ts`/`modelPlatforms.ts`.

O AionUI implementa PKCE, state, troca de código e refresh via HTTP. Não chama Codex CLI nesse módulo. Entretanto, usa um client ID fixo associado ao fluxo Codex e inclui referências divergentes a base pública e backend ChatGPT. Seus testes locais não demonstram, por si, autorização de plano para uma instalação comercial multiempresa. O exemplo de decode de JWT sem verificação não serve como validação de identidade no Prometeus. Nenhum segredo ou token do AionUI foi consultado ou reutilizado.

## Documentação verificada em 23/10/2026

- [Visão geral de uso do plano ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source)
- [Registro e autorização](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Contas, refresh e revogação](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Modelos e inferência](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Limitações da prévia](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Registro comercial](https://developers.openai.com/siwc/request-client-id)
- [Métodos de autenticação do OpenClaw](https://docs.openclaw.ai/providers/openai/authentication)

A documentação oficial distingue uso local/open-source e oferta comercial hospedada, que exige habilitação própria. Login de identidade não basta: é necessário consentimento explícito de uso do plano. Não usar o client ID de outra aplicação como substituto do registro do Prometeus.

O caminho local documentado permite registro dinâmico com identificador estável do host, callback loopback, state, nonce e PKCE. A identidade exige validação criptográfica do ID token e verificação do consentimento concedido. O catálogo e a inferência usam o bearer OAuth da conta na API pública. A inferência é streaming e só é bem-sucedida após o evento terminal de conclusão; limites podem falhar durante o stream. Renovação de tokens rotativos precisa ser serializada. Desconectar deve limpar credenciais e tentar revogação remota.

## Trabalho ainda necessário

Adicionar provedor convencional de OAuth direto, separado de `codex-local`, com conexão por workspace, segredos cifrados, callback protegido, catálogo da conta e adaptação da inferência às limitações do fluxo. Preservar journal de uso, revisões e política de resultados incertos. Não há implementação nem teste externo desse novo provedor neste documento. A elegibilidade da oferta comercial hospedada não está confirmada.
