# Prova controlada de CNPJ primeiro

Releitura de 08/11/2026 da segunda busca de Campinas. Dois datasets Maps já existentes retornaram 12 estabelecimentos distintos. Quatro tinham páginas de site recuperáveis no histórico e no dataset do crawler. Nenhuma dessas quatro coletas continha CNPJ válido detectado pelo extrator.

Para cada estabelecimento, o ensaio forneceu um cadastro fictício ativo com os atributos de identidade copiados do Maps. Uma das quatro coletas passou pela confirmação institucional mesmo sem o CNPJ no texto. Esse resultado demonstra que o cruzamento pode remover a dependência do CNPJ publicado. O cadastro foi construído a partir do Maps para isolar esse efeito. A prova não mede precisão contra cadastros independentes, cobertura do CNAE nem taxa real de admissão.

Os testes com dados fictícios confirmaram a aceitação com endereço corroborado e a recusa de homônimos, filiais com endereços diferentes, CNPJ divergente, associação ambígua e cadastro inativo. A revisão independente encontrou um caso de telefone central compartilhado e endereço ausente. O teste reproduziu a associação indevida. O protótipo passou a exigir endereço corroborado quando o site não confirma o CNPJ, e o teste voltou a passar.

O protótipo está em `tests/experiments/`. Verificação com `node --conditions=react-server --experimental-strip-types --test tests/experiments/cnpj-first.test.ts` e `npm run typecheck`. A rodada leu dados existentes por GET, sem criar Actors, jobs ou leads.

## Piloto cadastral real

Campinas, SP, CNAE principal 2512-8/00 de fabricação de esquadrias de metal, até 12 registros, sem quadro societário, com teto de US$ 0,05. A primeira tentativa retornou uma linha de erro da fonte Minha Receita com HTTP 429 e `Retry-After` de 60 segundos, sob status externo `SUCCEEDED`. Custo registrado zero. Após a espera, uma única repetição trouxe 12 inscrições ativas que correspondiam ao município e ao CNAE solicitados, em 5 segundos. O valor final registrado pela Apify foi US$ 0,041 após atualização da cobrança.

O lote continha 11 empresários individuais, dos quais 8 estavam marcados como MEI no total do lote. Apenas um registro trouxe telefone e logradouro com número. Nenhum dos 12 apresentou coincidência de nome normalizado ou telefone com os 12 resultados Maps anteriores. Nenhum vínculo foi confirmado. O piloto comprova a obtenção real de CNPJ ativo por CNAE e município. A amostra do Maps guardada era uma busca por nicho e não foi produzida procurando pelas empresas desse lote, portanto o resultado não mede a cobertura do Maps para elas.

## Busca direcionada no Maps

O único cadastro com logradouro, número e telefone foi usado como entrada. A busca enviou nome fantasia e endereço em Campinas, com até três resultados e sem adicionais. A API recusou o teto de US$ 0,05 antes de iniciar a execução. O teto mínimo aceito de US$ 0,50 já estava configurado no ambiente. A execução aceita terminou em 20 segundos e custou US$ 0,0042.

O Maps retornou uma ficha. O telefone, a rua e o município coincidiram. O nome, o número do imóvel e o CEP divergiram, e a ficha não informou site. A associação ficou sem confirmação. Não houve rastreamento de site, geração com IA ou criação de jobs ou leads no app. O custo combinado dos pilotos cadastral e Maps foi US$ 0,0452, com zero leads verificados.

## Lote dirigido com dados de contato

O piloto seguinte aplicou `companies`, `requirePhone` e situação ativa, com o mesmo CNAE e município. Os três registros retornados tinham telefone e logradouro com número, contra um em doze no lote anterior. A consulta cadastral custou US$ 0,014. A busca Maps em um único Actor, com até duas fichas por consulta, retornou quatro fichas e custou US$ 0,0162. O custo adicional foi US$ 0,0302. A amostra pequena não mede cobertura e não justifica tornar o filtro de natureza jurídica padrão.

Nenhum vínculo passou pela regra conservadora. Uma ficha coincidiu por telefone e rua, mas divergiu em nome, número e CEP. Outra coincidiu por nome, mas divergiu em endereço e telefone. A terceira coincidiu em nome, município, número e CEP, mas divergiu no nome da rua e no telefone. Uma leitura pública da página inicial da terceira ficha confirmou o telefone do Maps, sem publicar CNPJ ou corroborar o telefone cadastral. O caso fica pendente de confirmação independente do endereço ou do CNPJ. Nenhum job ou lead foi criado no app.

### Rechecagem do terceiro candidato

A inspeção dos campos estruturados mostrou que a divergência de rua era de abreviação. `R. Srg.` no Maps corresponde a `Rua Sargento` no cadastro. O nome comercial, o número e o CEP coincidem. Um espelho público do cadastro também associa o CNPJ ao endereço por extenso. A leitura do site confirmou o telefone do Maps, mas o telefone cadastral permanece diferente.

O teste do protótipo falhou antes da normalização e passou depois. Um número de imóvel diferente continua sendo rejeitado. Na releitura com dados reais, o protótipo verificou um vínculo em três cadastros usando o endereço estruturado, sem CNPJ publicado no site. Nenhum novo Actor foi iniciado. O experimento ainda não está ligado à jornada operacional.
