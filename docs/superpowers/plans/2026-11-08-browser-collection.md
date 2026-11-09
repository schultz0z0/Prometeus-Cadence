# 06B.6 — Busca web e coleta de sites com navegador próprio

**Decisão de 08/11/2026.** Substituir o Website Content Crawler da Apify pelo Scrapling com Chromium, preservando Apify para a base CNPJ, o Maps e a busca de resultados web. Separar a descoberta de URLs da leitura das páginas. O Prometeus continua responsável pela fila, pela validação de identidade e pela qualificação.

**Estado.** Plano aprovado para desenvolvimento. O experimento no Chrome é uma prova parcial do renderizador. A integração CNPJ primeiro iniciada no workspace precisa ser concluída com o novo provedor. O protótipo de retomada do Actor antigo fica fora do fluxo novo. [Análise e evidências](../../validation/2026-11-08-browser-collection-evaluation.md)

## 06B.6a — Renderizador Chromium isolado

- Criar um serviço Python sob `docker/site-browser/` com `Dockerfile` e arquivo de dependências travadas. Instalar `scrapling[fetchers]` pelo pacote publicado e o Chromium compatível no build da imagem. O experimento usou Scrapling 0.4.6 e Playwright 1.58.0. Confirmar a combinação na imagem antes de fixá-la para operação. Clonar ou manter um fork só se uma correção necessária no upstream justificar isso, com a versão e a licença registradas.
- Executar com usuário sem privilégios, contexto de navegador descartável por tarefa e rede de saída restrita. O browser não recebe credenciais da plataforma, volumes do host, perfil pessoal, acesso ao Postgres ou acesso à rede interna. O serviço usa uma interface privada com autenticação do worker e limites de corpo, concorrência e prazo.
- Usar `AsyncDynamicSession` para executar JavaScript. Definir ações permitidas para leitura, como rolagem e paginação observáveis. Bloquear submissões, downloads e destinos fora da política. Proteger redirects e subrecursos contra destinos privados no nível de rede, inclusive DNS que muda de endereço. A validação da URL inicial é uma camada complementar.
- **Aceite.** Na imagem Docker, provar DOM após JavaScript, seguir o link descoberto, ler uma segunda página e paginar por “Carregar mais”. A resposta registra URL final, status HTTP, texto e links. Um timeout libera a página e a vaga. Um site de teste tenta acessar serviço privado por redirect e JavaScript e nenhuma requisição chega ao destino. Dois contextos de workspaces distintos não compartilham cookies ou armazenamento.

## 06B.6b — Fila e retomada por URL

- Manter o orquestrador TypeScript e usar uma migração nova para guardar fila, resultado e tentativas por workspace, execução e URL canônica. Preservar RLS e o vínculo com a execução. As requisições pendentes têm lease e fence. Ao concluir uma página, gravar texto, hash, fontes, links novos e estado na mesma transação.
- Percorrer URLs públicas alcançáveis por sitemap e links do domínio permitido. Priorizar contato, sobre e informações legais na fila e depois continuar nas demais. Deduplicar URLs e registrar páginas bloqueadas por robots.txt, inacessíveis e ainda pendentes. Tempo e concorrência operacionais dividem a coleta em rodadas. Se um limite de segurança encerrar a coleta, registrar cobertura parcial.
- Repetir somente URLs recuperáveis com prazo por tentativa e espera progressiva. Usar o resultado já confirmado ao repetir uma etapa. Se o worker cair após ler a página e antes do commit, só aquela URL precisa ser lida de novo. A queda depois do commit não repete a leitura.
- **Aceite.** Derrubar e reiniciar o worker durante a coleta em banco efêmero, incluindo as duas fronteiras do commit. Demonstrar recuperação da mesma execução, zero perda de conteúdo confirmado, zero leitura repetida das URLs concluídas, cancelamento sem publicação tardia e isolamento entre workspaces.

## 06B.6c — CNPJ primeiro no app

- Ligar a entrada normal do Gerador e do assistente de automação à revisão de CNAE, município e UF. Executar **CNPJ ativo → Google Maps pelo estabelecimento → busca web se faltar um domínio utilizável → Chromium → validação de identidade → investigação e qualificação**. A busca web preserva a lista de candidatos e suas fontes. O vínculo com o site exige confirmação antes da entrega.
- Preservar requisitos de nome, telefone, site institucional e CNPJ ativo. Descartar homônimos, duplicados, encerrados e vínculos inconclusivos. Continuar pelo dataset e pelos recortes suportados até a meta ou o esgotamento das fontes, mantendo o registro de resultados parciais. Debitar a franquia ou créditos pelos leads novos entregues e liberar reservas não utilizadas.
- **Aceite.** Em banco efêmero, exercitar o fluxo normal com CNPJ, Maps e busca simulados e Chromium real. Asserções verificam ordem, rejeição de domínio genérico e de homônimo, reposição de candidatos, continuidade após timeout e repetição de confirmação sem nova cobrança ou Actor. A tela mostra origem da busca, cobertura do site e motivo de resultados parciais.

## 06B.6d — Troca do provedor de leitura de sites

- Inventariar os consumidores da leitura de sites e retirar novos disparos do Website Content Crawler. Preservar as evidências e os identificadores de runs anteriores e permitir observar ou encerrar runs já abertos com a autoridade existente. Versão do coletor e estado de migração entram na revisão para impedir a troca silenciosa de provedor no meio da mesma tarefa.
- Disponibilizar a configuração central e a saúde do serviço de navegador. Se o serviço estiver indisponível, a coleta fica aguardando recuperação ou mostra falha com motivo. A reversão operacional interrompe a entrada de novos jobs e conserva fila e páginas; voltar ao Actor pago exige decisão explícita.
- **Aceite.** Inspecionar os registros de execução e o tráfego de testes. Novas coletas de site usam Chromium. Os Actors de CNPJ, Maps e resultados de busca continuam funcionando. Conferir aplicação e worker juntos no ambiente local, sem iniciar buscas externas para o smoke de instalação.

## 06B.6e — Homologação e capacidade

- Rodar cenários controlados com site estático, SPA, paginação, sitemap, redirecionamento, domínio com erro e página lenta. Exercitar lote de 250 empresas elegíveis com fontes simuladas, reposição após descartes, mais de um workspace e recuperação de interrupções. Medir cobertura, erros, fila, memória, latência e consumo comercial.
- Depois, executar um piloto real pequeno mediante autorização específica para chamadas pagas. Medir cobertura do navegador, precisão dos vínculos CNPJ/Maps/site, custo da busca, tempo até o resultado e motivo de cada descarte. Separar evidência do navegador, da busca e da qualificação. Escala real e custo são aceites medidos em separado da simulação de 250.
- **Aceite.** Relatórios com critérios e resultados após as últimas alterações, revisão independente, suítes, build e tipos. Revalidar os estados afetados em 08A. O 08B usa os resultados para dimensionar e operar o serviço de navegador; a publicação e os fornecedores externos continuam sujeitos aos gates existentes.
