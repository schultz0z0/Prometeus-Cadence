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
