# 06D.1 — Autoria, variantes, anexos e publicação

27/10/2026. Implementação própria no ambiente local/controlado. Revisão independente concluída com quatro achados importantes corrigidos e gates finais aprovados. Não comprova produção pública nem paridade com estados inacessíveis da referência.

## Entrega

- Template copia assunto e corpo editáveis para a versão selecionada. Mensagem manual, sugestão de IA e template usam o mesmo rascunho. Prévia de IA identifica a versão e conserva o controle de revisão existente.
- Versões A/B completas, distribuição determinística por inscrição e conteúdo congelado na publicação. Repetir uma confirmação não troca a variante; editar o rascunho não altera uma versão já publicada.
- Anexos privados de e-mail: PDF, PNG, JPEG e texto; 10 MiB por arquivo, cinco arquivos e 20 MiB por mensagem, 200 MiB por workspace. Verificação de assinatura/formato/hash não é uma varredura antimalware. Demais canais bloqueiam anexos até existir adapter compatível.
- Autorização repetida no HTTP, transação, leitura do blob e barreira final do dispatcher. MIME leva os bytes verificados; não aceita caminho/URL arbitrários. Publicação, fila, agenda, consentimento e parada por resposta continuam nos serviços existentes.
- Arquivos exigem volume privado durável com `MESSAGE_FILES_ROOT` fora do localhost. Não há URL pública. O endpoint de download devolve attachment, no-store, nosniff e sandbox.
- Gerenciamento paginado no drawer permite excluir permanentemente arquivos sem uso, com confirmação nominal. Rascunhos salvos e publicações conservam as referências; arquivos rejeitados não consomem quota, e exclusão física incompleta continua reservada até recuperação. Identificador excluído não pode ressuscitar um upload antigo.

## Evidência executada

Testes de domínio/cliente, integração com banco efêmero e MIME: variável desconhecida, limites, acesso cruzado/revogado, revisão vencida, prova SQL direta, alteração durante I/O, A/B estável, conteúdo imutável, anexos realmente presentes no MIME e preservação de agenda/fuso/stopOnReply. A suíte completa e os gates finais são registrados em `evidence/06d1-message-authoring/verification.json` somente após execução.

Navegador: template copiado, alternância A/B, upload com primeira resposta503 e nova tentativa idempotente, arquivo inválido rejeitado/removido, download privado, anexo B ausente em A, gravação e recarga do rascunho. Encontrada e corrigida duplicação do editor causada por chaves React iguais em componentes irmãos; a regressão no navegador falhou com quatro campos e passou com um após a correção.

Capturas em1920×855,390×844 e320×844: `/cadences/new`, `/cadences/[id]`, editor B/anexos, configurações, `/templates`, edição de template, `/automations/new/ai` e revisão de publicação. Sem overflow horizontal depois das transições de layout; foco contido no drawer e Escape fecha. A revisão de publicação usa **fixture visual explicitamente bloqueada**, sem canal real e sem confirmação. A confirmação autoritativa e transmissão MIME foram verificadas em banco efêmero/adapter injetado. Não foi homologação de envio a um destinatário externo.

Comparação usa o acervo RES/REA existente, incluindo EV-215/EV-259 e o contrato visual vigente. Estados conectados/pagos, A/B e anexos sem captura equivalente da referência permanecem **não observados**. Não houve nova sessão autenticada da referência nem alegação de clone100% desses estados. Telas existentes mantêm geometria e componentes anteriores.

## Compatibilidade e limpeza

Migrações complementares085a/b/c/d preservam checksums de085 aplicada.085c admite cadências legadas sem etapas;085d conserva a precedência dos bloqueios existentes. Dois testes antigos de retry atravessavam meia-noite UTC e entravam legitimamente em espera de agenda/janela encerrada; essas fixtures usam um fuso válido que situa o relógio local perto de12h e envio em agora+2min. A primeira tentativa00:00 revelou agendamento para o dia seguinte e foi corrigida; barreiras do produto e testes próprios de calendário ficam inalterados.

QA dedicada L-011 e L-012: em cada rodada removidos contato, lista, rascunho, template e dois registros de arquivo; removido um blob válido ao fechar cada rodada, além do arquivo excluído explicitamente na UI pós-revisão. Preservado o histórico anterior e revogadas as sessões QA. Zero canais/publicações/outbox, mensagens externas ou chamadas pagas. [Fechamento inicial](evidence/06d1-message-authoring/closure-initial.json) e [pós-revisão](evidence/06d1-message-authoring/closure.json).33 capturas totais, seis após correções; exclusão, reupload e bloqueio409 de arquivo em uso confirmados no navegador em1920/390/320.

## Pendências com dono

- 06D.2: homologação de ida/volta e capacidades reais dos canais; anexo em outro canal exige adapter e teste explícitos.
- 06E.2/08B: retenção/coleta automática e ciclo completo de dados; a recuperação básica de quota e exclusão explícita de arquivos sem uso foram entregues neste marco. Retirar um anexo do rascunho não apaga automaticamente um arquivo histórico.
- 08B: volume durável, permissões/backup/restore, proteção antimalware adicional e operação/carga pública.
- 08A e área: diferenças dos estados não observados da referência; fixtures locais não são prova de paridade.

[Revisão independente e correções](06d1-message-authoring-review.md).085e/f/g recuperam arquivos/quota e reforçam conteúdo SQL/estados terminais;084d compatibiliza o upgrade anterior a085. **Aceite06D.1 local/controlado:**341/341 unitários,370/370 integrações completas,25/25 focadas e1/1 upgrade; build, tipos, diffcheck e checker RES aprovados. [Verificação](evidence/06d1-message-authoring/verification.json). Localhost200/seis lanes saudáveis. Próximo pacote: **06D.2 — canais, inbox e homologação de entrega**.

## Decisões registradas

O ledger de execução arquivado com o pacote conserva as decisões e custos, incluindo o limite inicial de retenção que foi revisado para entregar recuperação de quota agora. Os itens sem julgamento de fornecedor/referência/produção continuam com donos explícitos. Nenhum achado menor adiado nesta revisão.
