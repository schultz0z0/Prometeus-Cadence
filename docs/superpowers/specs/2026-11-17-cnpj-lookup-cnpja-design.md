# Consulta de CNPJ: CNPJá com fallback OpenCNPJ — desenho

Aprovado pelo usuário em 17/11/2026.

## Por quê
A consulta de um CNPJ (Qualificador, Enriquecedor, pesquisa da empresa) usa o Actor da Apify `bigdavidson/brazil-cnpj-companies`, cuja base de dados abertos não tem empresas reais (6 de 6 CNPJs do RJ testados não foram achados; opencnpj.org e open.cnpja.com acharam todos). O usuário escolheu a CNPJá (API comercial, base própria atualizada) como fonte principal e a API pública da OpenCNPJ (`api.opencnpj.org`, sem clonar o repositório nem baixar a base) como fallback.

## Objetivos
- Toda consulta de **um CNPJ** passa a ser: CNPJá → OpenCNPJ quando a CNPJá falhar ou não encontrar → "não encontrada" quando nenhuma achar.
- Mesmos dados que a ficha recebe hoje (razão social, nome fantasia, situação cadastral, endereço, telefone, e-mail, CNAE, sócios no Enriquecedor), com a fonte registrada na evidência.
- Celular antigo de 8 dígitos ganha o 9.

## Fora do escopo
- A fonte "CNPJ" do Gerador (busca por CNAE/UF/cidade) continua no Actor da Apify; muda numa etapa futura.
- Armazenamento próprio compartilhado entre workspaces (a base da CNPJá já evita créditos; reavaliar com volume).
- Clonar ou hospedar a OpenCNPJ.

## Anti-objetivos
- Uma falha da CNPJá não pode parar o lote nem deixar a execução em "conferir" (needs_reconciliation).
- Nunca aplicar dados de um CNPJ diferente do pedido (a verificação de identidade atual continua).
- A chave da CNPJá só na configuração protegida (`CNPJA_API_KEY`); nunca em log, evidência ou tela.

## Abordagem escolhida
Há um único ponto por onde passam as consultas cadastrais (`sourceResults(...,'registry',...)` em `src/server/prospecting/qualification.ts`), e ele já aceita adaptadores que respondem na hora (`start()` com resultado `inline`). Um adaptador cadastral novo (CNPJá → OpenCNPJ) entra nesse ponto no lugar da Apify, devolvendo o mesmo formato de candidato. Alternativa descartada: um serviço paralelo fora de `sourceResults`, que duplicaria o registro de chamadas, a cobrança e a verificação de identidade.

## Comportamento
1. **CNPJá:** consulta do estabelecimento pelo CNPJ com a estratégia de cache da CNPJá (dado com até 45 dias sai da base dela, sem crédito; mais velho, consulta online, 1 crédito). Sócios vêm da mesma resposta.
2. **Fallback para a OpenCNPJ** quando a CNPJá: não responde, dá erro do servidor, limite por minuto (429), sem créditos/plano, chave inválida, ou não encontra o CNPJ.
3. **Não encontrada:** quando as duas não acham → `CNPJ_NOT_FOUND` (comportamento atual: o Enriquecedor registra a empresa e segue; o Qualificador registra o módulo sem resultado).
4. **Erro nas duas** (sem ser "não encontrada") → `CNPJ_SOURCE_ERROR`, sem travar o lote.
5. **Sem `CNPJA_API_KEY`:** usa só a OpenCNPJ. A consulta cadastral fica sempre disponível (não depende mais de `APIFY_CNPJ_*`).
6. **Repetição segura:** consulta é leitura sem efeito colateral; falha de rede vira nova tentativa/erro do módulo, não `START_UNCERTAIN`.
7. **Celular:** telefone de celular com 8 dígitos locais (começando em 6–9) recebe o 9 na frente.
8. **Evidência:** URL pública da fonte (`https://cnpja.com/office/<cnpj>` ou `https://opencnpj.org/<cnpj>`) e o provedor registrado na chamada (`cnpja` ou `opencnpj`).

## Decisões do builder (minhas)
- Nomes de campos exatos das duas APIs, limites de tempo e o mapeamento para o formato de candidato.
- Contabilização de uso: unidade "consultas cadastrais" por provedor, custo desconhecido como hoje.
- Ajuste das mensagens de configuração e do texto de aviso.
