# 06D.1 — Revisão independente e correções

Uma revisão de contexto novo, somente leitura, em `c610614..61ccf56`, com o modelo mais capaz disponível. A mesma execução foi retomada após interrupção por limite de uso; não houve segundo revisor nem re-review. Veredito inicial: não pronto para aceite, quatro Important, zero Critical/Minor. O executor confirmou e manteve a graduação dos quatro pelo efeito sobre o usuário.

| Achado | Correção e prova |
|---|---|
| Reserva pending não retomava o put depois de falha | Mesmo requestId/hash retoma a gravação; lock exclusivo por arquivo impede concorrente de apagar o vencedor. Transações curtas autorizam antes/depois de I/O, usando um cliente e sem bloquear revogação durante o armazenamento. Retorno incerto do commit conserva bytes para recuperação. Teste falhou pending≠ready, depois passou com retry/concorrência e revogação durante I/O. |
| Quota incluía rejeitados e uploads abandonados sem recuperação | Rejeitados não ocupam quota de bytes; gerenciamento paginado mostra arquivos sem uso e permite exclusão explícita. SQL impede excluir referência em rascunho salvo/publicação; tombstone impede reviver requestId; falha na exclusão física mantém a reserva até nova tentativa. Testes de 200MiB, falha de exclusão, retry, cross-tenant, HTTP/origem/papel e proteção de referências. |
| SQL direto podia substituir text/subject mantendo revisão/anexos |085f vincula variante determinística, fatos atuais/congelados, texto/assunto renderizados, assinatura e preview ao snapshot. Envio de texto arbitrário com hashes/arquivos válidos falhou no teste antes da correção; depois é rejeitado. Binding legado sem recursos novos mantém compatibilidade. |
|085c era tarde para o backfill legado sem steps |084d normaliza ausência/null como lista vazia antes de085, sem modificar checksums aplicados. Teste cria catálogo pré085, reproduz a falha da085 original sem compatibilização e verifica upgrade completo/repetível, hash não nulo e horário preservado. |

Primeira execução das regressões:15 testes,11 aprovados e quatro falhas correspondentes. Após correção:15/15; contratos HTTP/cliente adicionais também passaram após RED,24/24 incluindo tenancy/commands/memberships e1/1 upgrade real. A suíte completa final e o pós-teste visual ficam no [aceite](06d1-message-authoring.md) e no JSON de verificações quando concluídos. Nenhuma nova revisão independente foi usada como substituto dos testes.

## Questões explicitamente deixadas fora da revisão

1. Entrega e recebimento reais/capacidades do provedor ficam em06D.2; sem piloto externo nesta execução, fixtures não comprovam entrega live.
2. Anexos WhatsApp/LinkedIn continuam bloqueados; habilitar exige adapter e contrato de capacidade verificados.
3. Paridade integral da referência não aceita; estados A/B/anexos sem captura equivalente continuam não observados.
4. Inspeção de formato/hash não é antimalware nem validação estrutural completa; controles adicionais são gate08B, sem alegação de arquivo livre de malware.
5. Volume durável, backup/restore e proteção do host pertencem08B; implantação sem isso não é aceita.
6. Retenção histórica e coleta automática ficam06E.2/08B. **Recuperação básica de quota foi corrigida agora**, não adiada.
7. Escala/throughput/carga pública ficam08B; testes locais não comprovam escala.
8. Resultado da suíte é responsabilidade do executor e precisa evidência completa; uma revisão estática não aprova testes ausentes.
9. Ajustes de fixtures de retry posteriores ao HEAD revisado são verificados por regressões/suíte do executor, sem suposta aprovação do revisor.
10. Correções posteriores não foram reexaminadas pelo revisor; regressões RED→GREEN e gates completos são a prova prevista pela execução nativa.

## Gates finais

Correções commitadas emdaf1798:341/341 unitários,370/370 integrações completas e25/25 focadas atuais (incluindo upgrade). Build/tipos/diff/checker RES aprovados; seis capturas pós-correção e cleanupQA. Nenhum Critical/Important aberto e nenhum Minor adiado. Sem re-review.
