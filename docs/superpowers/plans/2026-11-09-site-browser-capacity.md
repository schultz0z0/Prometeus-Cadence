# 06B.6e — Homologação e capacidade

1. Medir a admissão de 250 empresas no recorte CNPJ → Maps → site. Usar o worker e o Postgres efêmero com fontes sintéticas. Inserir descartes antes de completar a meta, uma interrupção e um segundo workspace.
2. Conferir cobertura do Chromium com páginas sintéticas, medir latência e memória e separar a prova do navegador da prova da fila e do consumo comercial.
3. Corrigir regressões observadas com teste falhando antes da implementação e revisão independente. Registrar o alcance, os limites da medição e o resultado das verificações.
4. Tratar ativação compartilhada e piloto real como etapas separadas da medição controlada. O piloto exige aprovação específica de chamadas pagas. Nenhum teste usa o worker do banco compartilhado.

A prova de capacidade usa `node scripts/test-integration.mjs 06b6e-site-capacity`. Ela é executada separadamente para medir o lote sem concorrência com a suíte padrão.
