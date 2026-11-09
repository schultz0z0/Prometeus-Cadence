# 06B.6a — Navegador de sites no Docker

O serviço local expõe `POST /render` com autenticação e retorna URL final, status HTTP, texto e links do documento renderizado. A imagem trava Scrapling 0.4.6, Playwright 1.58.0 e dependências com hashes. A imagem de Chromium usa digest fixo. O Compose fica separado do app e do banco locais.

O Chromium roda em container sem privilégios, em rede Docker interna e com contexto novo por requisição. Um gateway aplica a política a conexões HTTP e HTTPS, recusa métodos de escrita e endereços privados e usa os endereços validados para a conexão. O gateway publica só a porta de loopback. Os processos de teste foram encerrados ao final.

## Verificação

- O primeiro teste falhou pela ausência do renderizador. A revisão independente identificou um caso de redirect após clique que colocava o documento na URL errada. O teste novo reproduziu `/antigo` no lugar de `/novo/` e passou após corrigir a navegação para a URL final já validada.
- Oito testes passaram dentro da imagem, com Chromium real e rede externa desligada. Os cenários incluíram JavaScript, botão “Carregar mais”, visita à página descoberta, URLs relativas após redirect, isolamento de cookies e armazenamento, cancelamento de um recurso lento, recuperação da vaga HTTP e bloqueio de tentativas de escrita ou de acesso a um servidor privado observado.
- No Compose, o serviço retornou HTTP 200 e texto para uma leitura pública em `example.com`. A API recusou uma requisição sem credencial com 401. Um nome DNS apontado para um container privado foi recusado com 422 e o destino registrou zero requisições HTTP.
- Passaram os 460 testes unitários do app. O typecheck apontou erros no rascunho TypeScript anterior que experimentava continuar o Actor de sites da Apify, em `src/server/prospecting/discovery-admission.ts`. O serviço isolado não usa esse código. A integração do app, o build com o rascunho substituído e a homologação real da jornada ficam em aberto.

## Limites da entrega

O serviço renderiza uma página por requisição. A fila durável, o sitemap, a política de robots.txt e a retomada após queda da jornada pertencem ao 06B.6b. O 06B.6c liga essa coleta à ordem CNPJ primeiro. O 06B.6d faz a troca de provedor no app. Os testes atuais comprovam o isolamento e a recuperação nos cenários descritos. Páginas que exigem autenticação, CAPTCHA ou requisições de escrita ficam fora do contrato de leitura pública.

Para iniciar uma instância local, definir `SITE_BROWSER_TOKEN` em `.env.local` e usar `docker compose --env-file .env.local -f docker/compose.site-browser.yaml up -d --build`. A saúde fica em `http://127.0.0.1:3222/health`. A configuração ainda não conecta o serviço ao worker do Prometeus.
