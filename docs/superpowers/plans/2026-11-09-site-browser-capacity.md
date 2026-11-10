# 06B.6e — Homologação e capacidade

1. Medir a admissão de 250 empresas no recorte CNPJ → Maps → site. Usar o worker e o Postgres efêmero com fontes sintéticas. Inserir descartes antes de completar a meta, uma interrupção e um segundo workspace.
2. Conferir cobertura do Chromium com páginas sintéticas, medir latência e memória e separar a prova do navegador da prova da fila e do consumo comercial.
3. Corrigir regressões observadas com teste falhando antes da implementação e revisão independente. Registrar o alcance, os limites da medição e o resultado das verificações.
4. Tratar ativação compartilhada e piloto real como etapas separadas da medição controlada. O piloto exige aprovação específica de chamadas pagas. Nenhum teste usa o worker do banco compartilhado.

A prova de capacidade usa `node scripts/test-integration.mjs 06b6e-site-capacity`. Ela é executada separadamente para medir o lote sem concorrência com a suíte padrão.

## Troca local da lane de prospecção

1. Verificar o gateway autenticado, RLS forçada e o supervisor ativo. Exigir o app local fora do ar durante a troca.
2. Validar o PID, a linha de comando e a relação de parentesco do processo `jobs`. Exigir telemetria ociosa recente e, sob bloqueio breve no banco local, fila sem trabalho reclamável, jornadas sem execução e automações inativas. Manter os registros em reconciliação.
3. Encerrar apenas esse filho ocioso e observar o supervisor criar outro. Conferir PID novo, dois ciclos bem-sucedidos, demais processos preservados e contadores de jobs e consumo estáveis.
4. Usar a API e o navegador local em modo de revisão para conferir o Gerador. Separar a validação da instalação do piloto autorizado com fornecedores reais.

## Ativação local dos recortes de CNPJ

1. Confirmar um cadastro válido em cada faixa no build configurado e comparar os CNPJs em memória.
2. Ativar os recortes para novas revisões com a porta do app livre, sem jobs em andamento, jornadas em execução ou automações ativas. O worker lê a política congelada na revisão, portanto a ativação dispensa reiniciar a lane.
3. Em servidor temporário com execução de prospecção desabilitada, conferir a revisão no Gerador. Encerrar o servidor e remover a conta descartável.

## Piloto de admissão de um lead

1. Preparar e confirmar a jornada pelo handler do aplicativo em Postgres efêmero com conta descartável. Rodar `runWorkerOnce` até a fase de descoberta encerrar, com teto acumulado e checagem dos mínimos de cada Actor.
2. Registrar a ordem de CNPJ, Maps e site, os descartes, a cobertura do navegador, as reservas e o custo informado pela Apify. Reaproveitar datasets já pagos para diagnosticar descartes.
3. Se a amostra não entregar um lead, usar em separado uma empresa com correspondência conhecida em datasets reais já disponíveis. Conferir se o site ao vivo é renderizado, se o mesmo lead recebe as três evidências e se a liquidação fecha com zero reservas.
4. Registrar em separado o aceite no worker contínuo e a revalidação do 08A. Remover a conta e o catálogo de prova e manter somente agregados.
