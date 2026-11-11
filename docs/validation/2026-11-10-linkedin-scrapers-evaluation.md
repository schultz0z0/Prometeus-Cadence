# Raspadores de LinkedIn na Apify — avaliação sem ativação

Em 10/11/2026, a pedido do operador, foram avaliadas as páginas públicas de quatro raspadores de LinkedIn da loja da Apify. Nenhum foi executado, nenhum foi configurado e nada foi cobrado. A avaliação vale para qualquer uso de raspagem do LinkedIn no Prometeus: Gerador, Qualificador e Enriquecedor. O ato é o mesmo, e o risco também.

## O que os raspadores oferecem

| Raspador | Para que serve no Prometeus | Entrada | O que devolve | Preço anunciado |
| --- | --- | --- | --- | --- |
| `harvestapi/linkedin-profile-scraper` | Enriquecedor: detalhar um perfil já conhecido | URL ou identificador do perfil | Experiência, formação, local; e-mail "quando encontrado" | US$ 4 por mil perfis; US$ 10 por mil com busca de e-mail |
| `harvestapi/linkedin-company-employees` | Enriquecedor: listar funcionários de uma empresa e filtrar por cargo | URL ou nome da empresa, cargos, local | Nome, perfil, cargo atual, histórico; e-mail "quando encontrado" | A partir de US$ 1,50 por mil perfis básicos |
| `harvestapi/linkedin-profile-search` | Gerador: buscar pessoas por cargo, empresa e local | Nome, empresa, cargo, local | Perfis; e-mail opcional | A partir de US$ 3,20 por mil perfis |
| `apimaestro/linkedin-profile-detail` | Enriquecedor: detalhar um perfil | URL ou usuário | Experiência, formação, local; e-mail | A partir de US$ 5 por mil perfis com busca de e-mail |

Todos afirmam funcionar sem cookies e sem conta do LinkedIn. Isso tira o risco da conta do operador, mas não o risco de contrato e de dados pessoais descrito abaixo.

## Contra o que já está decidido no Prometeus

- **E-mail adivinhado.** Os raspadores dizem achar o e-mail por "busca independente" e validá-lo por SMTP. Na prática, isso costuma ser montar o endereço a partir do nome e do domínio e testar se a caixa existe. A regra do Enriquecedor proíbe adivinhar padrão de e-mail e exige contato publicado e atribuído por citação literal. Um e-mail assim só poderia entrar como "não verificado", fora dessa regra.
- **Celular.** Nenhum dos quatro promete celular ou WhatsApp. O gargalo do Enriquecedor, o contato pessoal do sócio, continuaria aberto.
- **Cobertura.** Boa parte dos leads do Prometeus são MEIs e pequenos negócios locais. Esses sócios raramente têm perfil completo no LinkedIn; a taxa de acerto em Curitiba não foi medida.

## Riscos

- **Contrato do LinkedIn.** A seção 8.2 do contrato de uso proíbe desenvolver, apoiar ou usar software, robôs ou outros meios para raspar ou copiar perfis e dados, e também usar dados obtidos por agregadores sem consentimento. A central de ajuda do LinkedIn repete que ferramentas de raspagem violam o contrato. [Contrato de uso](https://www.linkedin.com/legal/user-agreement) · [Ferramentas proibidas](https://www.linkedin.com/help/linkedin/answer/a1341387)
- **Precedentes.** O LinkedIn processou a Nubela, dona da Proxycurl, em janeiro de 2025; a Proxycurl encerrou em 4 de julho de 2025 após acordo. Em outubro de 2025 processou a ProAPIs. A hiQ venceu a discussão sobre a lei de acesso a dados públicos nos EUA, mas perdeu por quebra de contrato e encerrou em 2022. [Encerramento da Proxycurl](https://nubela.co/blog/goodbye-proxycurl/)
- **Dependência de fornecedor.** Se o fornecedor do raspador for processado ou bloqueado, a fonte some de uma hora para outra, como aconteceu com a Proxycurl.
- **LGPD.** Perfil público continua sendo dado pessoal. Coletar em massa para prospecção pede base legal registrada (provavelmente legítimo interesse, com avaliação de impacto), transparência e atendimento a pedidos de exclusão. Isso não é parecer jurídico; precisa de leitura de um advogado.

## Recomendação

Não ativar raspagem de LinkedIn em nenhum módulo agora.

1. Manter a pesquisa no Google por perfis já indexados, que o Enriquecedor já usa sem entrar no LinkedIn.
2. Para LinkedIn como canal e fonte, seguir pelo marco 07A (Unipile, com conta autorizada pelo próprio usuário), que depende de contrato e leitura jurídica.
3. Se o operador quiser mesmo assim testar um raspador, fazer uma rodada isolada, fora da oferta contratável, com um único raspador sem cookies, 10 perfis, e medindo: quantos sócios da Base CNPJ têm perfil, quantos e-mails vêm e quantos desses passam numa validação independente. A decisão de uso em produção fica com o operador, depois da leitura jurídica.
