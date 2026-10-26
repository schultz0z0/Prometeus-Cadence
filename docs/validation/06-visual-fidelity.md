# Correção de fidelidade visual —25/10/2026

O usuário reiterou que a entrega inicial deve reproduzir o visual, os fluxos e as funcionalidades observáveis do CadenceFlow. A personalização visual fica para depois. Uma interface própria com funções equivalentes não satisfaz esse requisito.

## Referência e escopo

Três imagens fornecidas pelo usuário e observação autenticada L4 de `https://app.cadenceflow.pro/settings/plan` em25/10/2026. Somente leitura e troca transitória de abas; nenhuma compra, trial ou alteração de dados na referência. Dados pessoais não são reproduzidos nos registros de comparação.

Medidas observadas em1920×855, DPR1: menu260px, header56px, faixa de trial36px, navegação de configurações208px, separação32px, área de plano1152px. Manrope14px/20px nos controles e Exo2 nos títulos. Cartões brancos com borda cinza e raio16px; uso em seis cartões neutros com raio12px; abas em trilho cinza e seleção branca. Resumo com faixa azul. Cobrança em painéis recolhíveis e formulário inline. Adicionais por categoria com seletor, antes da comparação de planos. Os estilos foram reimplementados; fonte Exo2 obtida do Google Fonts, com licença OFL incluída.

Correção imediata: três abas de plano/cobrança e geometria/tipografia da navegação compartilhada; remover trial falso em assinatura ativa; manter dados reais e revisões transacionais. Decisões explícitas preservadas: trial7 dias, consumo pré-pago, infraestrutura própria e OpenWA. Recursos ainda não entregues ficam indisponíveis para compra. Marca de trabalho do projeto preservada; logo e assets proprietários não foram copiados. Não há alegação de réplica100% do produto inteiro nesta entrega.

## Verificação

Entregue no código: três abas reestruturadas, seis cartões de uso, resumo com faixa azul, adicionais por categoria com seletor e saldo, comparação de planos, histórico em painel recolhível, contato inline, navegação e menu de conta compacto. A assinatura ativa alimenta o menu em vez da indicação fixa de trial. Conteúdos das abas permanecem montados para não apagar o contato ou a tentativa pendente; dados rejeitados com erro definitivo podem ser corrigidos, enquanto resultado incerto preserva a mesma tentativa. A navegação de teclado no mobile inclui summary e campos nativos.

Verificações concluídas:262/262 unitários existentes (`.runtime/reference-ui-unit.log`); tipos sem erros; build final concluído após as correções da revisão (`.runtime/reference-ui-final-build.log`); `git diff --check` sem erros; detector mecânico retornou lista vazia. Revisão independente encontrou três problemas importantes (rascunho ao trocar de aba, recuperação após rejeição e foco mobile), corrigidos antes do build final. O roteiro `scripts/qa-billing-ui.mjs` foi atualizado para os novos controles, mas não foi executado nesta sessão.

Na versão renderizada intermediária, a inspeção DOM confirmou seis cartões, Essential ativo, conta de e-mail1/3, cadências0/100, automações0/50, templates reais, saldo5.000/5.000 e link lateral do plano ativo. A inspeção final foi interrompida pelo mecanismo de Computer Use porque ele não conseguiu confirmar a URL da janela com segurança. As capturas CDP também expiraram. Portanto, comparação visual final, teste mobile no navegador e exercício final dos três fluxos de formulário continuam pendentes; não há screenshot final aprovado nem aceite de paridade pixel a pixel. Nenhuma compra, alteração de contato ou mudança de assinatura foi confirmada nesta correção.

O aplicativo foi recompilado e retomado em127.0.0.1:3210, com os serviços permanentes. A aba de leitura da referência terminou em Meu plano, pois o bloqueio do controle impediu restaurar a aba transitória anterior; nenhuma configuração ou registro foi alterado.

O checker da KB anterior apontou113 referências não reconhecidas e uma advertência de nome de arquivo, já existentes antes desta sessão, e zero linhas de ledger abertas. Esse resultado não será apresentado como aceite integral do acervo; saneamento documental permanece registrado separadamente da interface.


## Auditoria integral em andamento — s02

O acesso para comparação visual foi recuperado por sessões próprias do Playwright CLI. A referência foi autenticada manualmente pelo operador. Capturas mascaradas de 50 URLs em desktop1920×855 e celular390×844 (DPR1) foram concluídas, junto da primeira amostra de 14 overlays por viewport. Artefatos privados em output/playwright/visual-audit; nenhum cookie, token ou dado de cliente entra na KB. A contagem registra aquisição de evidência, não aprovação visual.

As comparações revelaram diferenças de estrutura em gerador, campanha LinkedIn, enriquecimento, SDR e template, além de switches e overflow mobile. Correções estão no código; o build e a varredura local final precisam terminar antes de qualquer aceite. O marco seguinte permanece suspenso até encerrar a matriz de comparação e as pendências de estado. Testes de domínio nesta rodada:262 aprovados,0 falhas (.runtime/visual-tests.log).


### Continuação da comparação e correções aplicadas — s03

- Pós-build: 100 visitas locais (50 rotas × desktop/mobile), sem pageerror, falha de rota ou overflow horizontal. Há 28 aberturas/cancelamentos de menus e popups locais sem falhas; o painel de produtos em Contexto de IA, anteriormente oculto por CSS no mobile, foi recuperado. Isso verifica navegação/renderização e não constitui aceite de todos os estados do produto.
- Correções adicionais: ficha de lead em três colunas; localização separada; ações no topo; LinkedIn com hero central, etapas separadas, filtros compactos e enriquecimento em painéis; CRM/apps e Google Sheets específicos; MCP, duplicados e privacidade; arte dos estados vazios de pipeline/templates; campos de termos em chips no wizard de automação; cadastro em duas etapas e recuperação de senha.
- Cadastro verificado em320,390,768 e1920px: seleção Essential/Pro e nome preservados na ida/volta, sem transbordamento e sem submissão. Trial continua7 dias, Essential, sem cartão nem cobrança automática. Seleção do cadastro não ativa trial nem assinatura: segue para revisão após autenticação/workspace.
- Rascunho de resposta de e-mail: editar, fechar histórico, reabrir e conferir preservação passou; texto anterior restaurado, nenhuma mensagem enviada. A referência foi somente lida e teve abas/menus transitórios restaurados. Fontes: ciclo observado16→18→14→16; tipografia de referência convertida para rem para acompanhar o controle AA. Tema testado transitoriamente e restaurado.
- Regressão encontrada na comparação mobile: dropdowns de contatos cortados à esquerda e rodapé do compositor de template fora da área inicial. Corrigidos; o compositor passa a ter área de campos rolável e ações separadas. As capturas pós-correção específicas ainda precisam ser conferidas após o último build.
- Editor existente da referência: cinco abas observadas em desktop/mobile, incluindo capturas estáveis depois de aguardar a rede. Saúde e Relatório tinham skeleton inicial; ele não foi tratado como estado final. Não copiar o benchmark proprietário de respostas nem anunciar conexão validada sem validação do nosso servidor.
- Verificação de código: tipos e build aprovados nesta rodada;262 testes de domínio passaram novamente,0 falhas (.runtime/visual-release-tests.log). Checagem estática não encontrou nomes literais de ícone sem implementação.
- Continuidade: não há aceite100% da interface inteira. Permanecem pendentes os estados profundos do editor/popups, fluxos que exigem ativação/pagamento/conexão na referência e a matriz final de diferenças por estado. Não avançar o roadmap com base apenas nas100 capturas.

### Revalidação consolidada — s04,26/10/2026

Os testes posteriores substituem as pendências históricas acima somente no escopo demonstrado. O editor profundo ganhou gaveta lateral, etiquetas de variáveis com contrato textual, navegação entre etapas e rodapé mobile. Validados mensagem vazia, cursor, colagem sem HTML, desfazer, reabertura e Enter/Shift+Enter; a duplicação de quebra na primeira linha vazia foi encontrada e corrigida. Templates, contatos, contexto de produtos e atalhos de menu/busca receberam os testes locais descritos em `docs/reverse-engineering/visual-2026-10-25/REPORT.md`.

Varredura pós-correções:100 visitas,50 rotas ×desktop/mobile,0pageerrors,0falhas de rota,0overflow;28 overlays sem falhas. Depois do último ajuste localizado,21 verificações em320/390/1920px confirmaram os sete destinos alterados, incluindo não sobreposição no MeetFlow, formulário FunnelsFlow e seleção/título de relatórios. Build final e checagem de tipos aprovados,262 testes existentes aprovados, `git diff --check` limpo. Logs locais ignorados: `.runtime/visual-final-shell-build.log`, `.runtime/visual-final-layout-tests.log`, `.runtime/visual-final-layout-check.log`. Evidência resumida em `evidence/EV-265-validation-results.json` da KB visual.

O operador determinou registrar como não observados os estados bloqueados por plano/conexão na referência; não foram comprados acessos nem ativados trials. Isso não equivale ao aceite desses estados. Cadastro público ainda difere em telefone/documentos legais; controles indisponíveis e medições ausentes conservam estados verdadeiros. Portanto não há declaração de réplica100% de todos os estados e assets. O próximo marco continua sem ser iniciado por esta rodada.

Rascunho temporário arquivado somente no QA, sem publicação/envio; Agência Prometeus restaurada. Localhost retomado com serviços contínuos ativos; ledger0aberto,uma fixture arquivada explicitamente registrada.

### Continuidade06A-P / diferenças conhecidas06A-V —26/10/2026

A pendência histórica de telefone/documentos no cadastro foi implementada, com validação/persistência no servidor e publicações jurídicas próprias versionadas. O assistente ganhou painel flutuante lateral conforme a anatomia observada; conversa e sugestões contextuais reais ficam06F, sem simulação. Mantidos7 dias, ausência de cartão/autocharge e estados próprios de disponibilidade.

[Validação do pacote](06-entry.md):265 unitários,266 integrações completas e19 focadas após publicaçãov2/proteções de enumeração; comparação cadastro1920/390/320, painel1920/390,36 verificações de rotas sem overflow/pageerror e jornada real local de entrada/recuperação/convite inválido. Documentos são de homologação, sem identificação jurídica inventada. Nenhum estado anteriormente não observado virou aceite de paridade100%. Próximo pacote:06A-H, ciclo financeiro em sandbox.
