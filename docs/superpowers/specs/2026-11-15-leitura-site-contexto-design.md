# Leitura do site no Contexto de IA (até 12 páginas)

Aprovado pelo usuário em 15/11/2026.

## Por quê
Reler o site em Configurações → Contexto de IA só lia home, sobre e contato (3 páginas, 12.000 caracteres). No site agenciaprometeus.com.br ficaram de fora `/servicos` e as páginas de cada serviço, e a proposta de contexto saiu sem oferta e produtos citáveis.

## Objetivo
- A tarefa `context_read` lê até 12 páginas do mesmo domínio, até 48.000 caracteres no total (no máximo 12.000 por página).
- Descoberta: `sitemap.xml` (ou o declarado no `robots.txt`); sem sitemap, links internos da home.
- Prioridade: serviços, produtos, soluções, planos e preços; depois sobre e contato; depois o resto.
- Todas as páginas lidas viram fontes da proposta (o teto de 3 `public_page` sobe para 12 nas validações de resultado e de gravação).

## Fora do escopo
- Pesquisa de empresas, admissão, Qualificador e Enriquecedor continuam com o orçamento atual (3 páginas, 12.000 caracteres).
- Gravar o site na Base de conhecimento (passo seguinte do backlog).

## Abordagens consideradas
1. **Até 12 páginas dentro da tarefa atual** (escolhida): mudança pequena, 1 a 2 minutos, sem custo de fornecedor (leitura pelo serviço próprio com Scrapling).
2. Site inteiro com o coletor durável `collectSiteTick` (até 500 URLs): cobre tudo, mas exige pausar/retomar a tarefa de planejamento e pode levar muitos minutos.

## Decisões do construtor
- `fetchEvidencePack` ganha um quarto parâmetro opcional de orçamento `{pages, chars}`; o padrão mantém o comportamento atual para os outros chamadores. Com `pages>3` usa descoberta por sitemap + prioridade.
- Divergência registrada no AGENTS.md.
