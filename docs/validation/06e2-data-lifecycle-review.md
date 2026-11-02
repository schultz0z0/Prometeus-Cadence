# Revisão final — 06E.2

02/11/2026. Uma revisão independente em contexto novo (subagente somente leitura, Claude Opus 5.5), no intervalo imutável 2351d05..29c0122. Sem Critical. Seis Important e um item incerto corrigidos numa passagem RED→GREEN, na migração 092a e em `merge.ts`, sem segunda revisão.

| Achado | Correção | Regressão |
|---|---|---|
| Excluir empresa enriquecida falhava (FK de `enrichment_delivery.cache_id`); a mensagem chegava mascarada como "Lista não encontrada" | O trigger de exclusão não apaga mais `enrichment_resolution` | Falhava antes (23503); passa depois |
| Desfazer podia remover um opt-out real que colidiu com a linha da fusão | O desfazer nunca remove supressões | Supressão continuava 0 após desfazer; agora 1 |
| Restaurar atribuição de automação descartada violava colunas NOT NULL | A fusão guarda a linha inteira; o desfazer reinsere com `jsonb_populate_record` | Teste de restauração exata |
| Desfazer não restaurava `lead_identity`, pessoas aplicadas nem resoluções | Identidades guardadas e reinseridas; `applied_lead_id` e `enrichment_resolution.lead_id` movidos e devolvidos | `applied_lead_id` era NULL antes; agora volta ao original |
| Opt-out de telefone sem identidade no principal era descartado | O grupo é recusado (`MERGE_CONFLICT_CONSENT`) | Fundia antes; agora falha sozinho |
| PII de contatos fundidos sobrevivia | Snapshots apagados ao excluir o principal e ao vencer a janela de 7 dias (worker) | Coberto pelo código da purga; sem teste dedicado (ver menores) |
| Incerto: matrícula movida fica fora do snapshot da publicação | Conservador: recusar fusão quando o contato a apagar tem matrícula ativa/bloqueada | Sem teste dedicado (fixture de publicação); regra SQL simples |

Menores corrigidos na mesma passagem:
- **Replay com grupos não revisados:** a verificação só é dispensada quando todos os grupos do `requestId` já têm registro (teste).
- **Ordem de checagem:** chaves agora checadas depois do `FOR UPDATE`.
- **Contato mais antigo:** a regra passou a ser imposta no SQL (teste).
- **GUC de fusão:** passou a exigir `state='merged'`.
- **Checagem de conflito do desfazer:** inclui enriquecimento, itens e atribuições.
- **Cache:** limpo uma vez por comando em vez de por linha.

## Menores e limites adiados (owner 08A)

1. A purga de snapshots expirados e a recusa por matrícula ativa não têm teste de integração dedicado.
2. O desfazer mantém no principal os campos copiados, por decisão de fidelidade ao texto da referência; não é um inverso exato.
3. A retenção não apaga o assunto nem os anexos de e-mail, também como a referência.
4. Exportação privada (24 h / links de 5 min) não foi implementada; fica como pendência explícita, sem oferta na UI.

Verificação após as correções: focada 11/11; 371/371 unitários; 477/477 integrações; build e tipos exit 0. A QA de navegador foi feita antes da revisão; as correções não alteram a UI além das mensagens de erro novas.
