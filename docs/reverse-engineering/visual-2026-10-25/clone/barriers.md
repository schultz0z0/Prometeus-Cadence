# Production barriers: CadenceFlow Visual

Clone target market: see `00-charter.md`.
Not legal advice. A legal reading without a source is `[inf]` with a question for counsel in `questions.md`.

## Summary

Launch blockers first. One row per barrier; details below.

| Barrier | Category | Severity | Market weight | Blocks | Lead time |
|---|---|---|---|---|---|
| BR-001 LinkedIn official capabilities | permissioned integration | blocks feature | alta para prospecção LinkedIn |07A convites/mensagens | Prazo depende de aprovação; não confirmado |
| BR-002 Contato pessoal e acurácia | data/provider coverage | adds cost | alta para enriquecimento | Cobertura garantida de celular/WhatsApp | Piloto próprio necessário |

### BR-001 LinkedIn oficial não é autorização genérica para cadências

- Gatekeeper: LinkedIn. [doc SRC-003] [doc SRC-004] [doc SRC-005].
- Convites e mensagens exigem programas/permissões aprovados. Mensagens requerem ação afirmativa específica do usuário e excluem eventos programados/automatizados; OAuth self-service não substitui esses direitos.
- Mitigação no07A: comprovar capacidades reais do aplicativo aprovado; bloquear ações não habilitadas, manter rascunho/ação humana quando compatível. Não prometer convite ou cadência automática pela API oficial sem suporte do contrato concedido. Apify para fonte pública não concede direitos de envio pela API oficial.
- Prazo/custo: não confirmados; não inventar aprovação ou fornecedor alternativo. Isso descreve documentação pública, não o backend do CadenceFlow.

### BR-002 Cadastro empresarial e busca pública não garantem contato pessoal

- [doc SRC-001] [doc SRC-002] O Actor configurado fornece dados empresariais e QSA opcional; nomes/cargos não comprovam titularidade de telefone. E-mail ausente continua desconhecido.
- [obs EV-270] Implementação própria06B.2 rejeita telefone corporativo, exige pessoa/cargo/contato atribuído e citação literal; nenhum Actor LinkedIn autenticado dedicado foi configurado. Páginas públicas podem não conter o dado necessário.
- Mitigação: abstenção, zero crédito comercial para vazio, limite de novas consultas, fontes/qualidade visíveis e piloto pago próprio autorizado. Acurácia, cobertura e atividade de WhatsApp não foram certificadas.

<!-- Example section:
### BR-001 WhatsApp messages need Meta business verification
- Category: permissioned integration
- Blocks: F-014
- Gatekeeper: Meta, WhatsApp Business Platform
- Severity: blocks feature
- Market weight: required to sell
- What it takes: business verification, approved message templates, per-message fees
- Lead time and cost: [doc SRC-021]
- Mitigation: start verification in month one; launch with email notifications
- Evidence: [doc SRC-021]
-->
