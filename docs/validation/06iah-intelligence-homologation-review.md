# Revisão independente06IA-H

Uma revisão independente de `e6248c1..7daba4e`, em modo somente leitura, conforme o pacote de revisão. Sem outro revisor ou segunda rodada de revisão. O revisor reproduziu os quatro testes unitários iniciais e60saídas offline, além de conferir os nove hashes/dimensões das capturas. As suites completas/build são verificações do executor, separadas do julgamento independente.

## Resultado e passagem de correção

Nenhum Critical. Dois Important aceitos pelo executor:

1. O scorer verificava a citação sanitizada no texto bruto; a proposta original de `cpf-age-redaction` era descartada pelo validador, mascarando o problema. Regressão unitária reproduziu2fatos indevidamente sem suporte; a integração reproduziu a reprovação das saídas válidas. O scorer agora compara a representação sanitizada usada no pipeline, a proposta sintética contém a mesma citação permitida e o dataset passou a`research-gold-v2`. CPF/idade não reaparecem nas saídas; uma citação inventada continua rejeitada.
2. O índice de exclusão live retinha indefinidamente `running`/`uncertain`, sem encerramento administrativo. Regressões reproduziram ausência do serviço de encerramento e criação de journal por arquivo incompleto. Migração complementar088a adiciona encerramento revisado/idempotente com sessão administrativa atual, revisão de receipts, lease expirado e estado`closed`. Nenhuma chamada é repetida ou declarada não cobrada. Receipts tardios permanecem possíveis com token restrito; nunca podem publicar sucesso. A CLI valida o conjunto completo de variantes antes de iniciar o journal e oferece`prepare-close`/`close`. A regressão também expirou lease durante cotação: antes ocorria1dispatch, agora0. Uma sessão administrativa nova pode encerrar após a sessão original vencer, com teste real da CLI e replay.

As correções foram executadas numa passagem, guiada pelas regressões RED→GREEN, sem nova revisão. A conclusão e os totais finais ficam no [relatório de aceite](06iah-intelligence-homologation.md) e na [verificação](evidence/06iah-intelligence-homologation/verification.json).

## Menor adiado

P3: aritmética binária na comparação de custo pode parar uma avaliação antes da última saída quando60×US$0,01 são comparados aUS$0,60, pois a soma pode ser0,6000000000000003. Não permite cobrança maior que o limite; interrompe conservadoramente. Dono:08A, regressão de orçamento e representação decimal/inteira. Não corrigido nesta passagem, conforme protocolo da execução nativa.

## Comportamentos não julgados pelo revisor e decisões do executor

- Acurácia real/resistência probabilística à injeção: não houve inferência externa. Mantido gate de piloto real; custo se inadequado: comportamento de modelo real ainda pode divergir dos contratos controlados.
- Autenticidade de outputs/receipts submetidos pelo administrador: é benchmark dos dados fornecidos, sem atestação de origem. Mantido`empirical:false`; custo: dado administrativo incorreto pode distorcer a avaliação local.
- Paridade visual completa, estados conectados/loading/erro/sucesso e interação real: nove imagens foram inspecionadas, mas não provam os estados ausentes. Executor inspecionou as nove e conferiu navegação/foco/Escape/overflow; sem aceite integral. Custo: diferenças dos estados não observados permanecem até a área/08A.
- Operação paga/deadlines/reconciliação do fornecedor/implantação pública: nenhum adapter pago foi selecionado. Serviço controlado e encerramento administrativo não atestam reconciliação externa. Gate piloto/08B preservado; custo: configuração e operação real ainda exigem homologação própria.
- Banco operacional, restauração QA e totais completos/build: revisor somente leu os registros. Executor aplicou migrações locais, verificou cleanup/runtime e repetiu suites/build/tipos; custo: evidência operacional depende dessa execução, não de duas execuções independentes.

Todas as decisões e seus custos também constam no [ledger](evidence/06iah-intelligence-homologation/execution-ledger.md). A conclusão original foi “With fixes”; o aceite final é do executor após as regressões e suite verde, sem alegar uma segunda aprovação do revisor.
