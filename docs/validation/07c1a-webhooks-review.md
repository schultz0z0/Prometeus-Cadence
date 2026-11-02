# Revisão final — 07C.1a

02/11/2026. Revisão independente feita por um subagente somente leitura, em contexto novo, sobre o intervalo imutável 630aebb..bc134d2. Sem Critical: os bloqueios de endereço, a fixação de IP, a assinatura, o isolamento, a cifra do segredo, o limite de 10 e a transação do evento foram confirmados. Seis Important e os menores baratos foram corrigidos numa passagem RED→GREEN (migração 095a e commit 0140087), sem segunda revisão.

| Achado | Correção | Regressão |
|---|---|---|
| Um receptor lento de um tenant travava as entregas de todos | Uma tentativa por destino por tick e um claim por tentativa | Dois destinos, quatro entregas: um POST por destino |
| O lease cobria o lote inteiro e expirava antes das últimas tentativas | Lease de 30 s iniciado em cada tentativa; nada fica reivindicado ao abortar | Mesmo teste e o da tentativa incerta |
| Destino pausado ainda podia receber | O claim exige destino ativo e sem alerta; pausa durante a tentativa cancela a retentativa | Pausa durante a tentativa: cancelada e 0 POST depois |
| Resposta automática e bounce de e-mail disparavam "Lead respondeu" | E-mail só depois da classificação humana e do vínculo pela outbox; o trigger de mensagem cobre só WhatsApp | Mensagem de e-mail sem classificação: 0 eventos |
| Falha na emissão derrubava importação, salvamento ou sincronização | Payload acima de 200 mil caracteres vira referência; qualquer erro da emissão vira aviso | Lead com 250 mil caracteres: gravado, evento com `truncated` |
| Cópia do lead sobrevivia à exclusão, sem retenção | A exclusão cancela entregas e apaga a cópia; purga de 30 dias no lane; índices de idade e de tentativa em andamento | Exclusão: entrega cancelada e dados `{deleted:true}` |

Menores corrigidos:
- **Falhas seguidas:** contam também as falhas retentáveis (teste).
- **Teste sob alerta:** é recusado com 409 em vez de entrar na fila como retido (teste).
- **Create repetido:** precisa bater em eventos e listas (teste).
- **Restauração de fusão:** a isenção usa a mesma checagem do guarda de cobrança.
- **Trigger:** confere se existe destino antes de montar o payload.
- **Segredo curto:** recebe mensagem própria.
- **Interface:**
  - listas removidas saem da edição;
  - botões ficam desabilitados durante uma ação;
  - gerar um segredo novo pede confirmação;
  - o segredo fica fora de região viva, com foco ao aparecer;
  - entregas em andamento se atualizam sozinhas.

Item mantido: `Retry-After` além da janela de 24 h encerra a entrega na hora, como o plano define.

## Menores adiados (owner 08A)

1. Sem teste dedicado do caminho positivo da resposta por e-mail.
2. Portas fora de 80/443 recusadas (herdado de `approvePublicUrl`).
3. Sem recuo por destino após vários timeouts seguidos; a regra de uma tentativa por tick limita o impacto.
