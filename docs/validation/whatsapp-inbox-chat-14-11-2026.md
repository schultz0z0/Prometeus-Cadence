# Inbox do WhatsApp em estilo chat — divergência visual aprovada (14/11/2026)

O operador pediu em 14/11/2026 uma Inbox do WhatsApp parecida com o WhatsApp Web, mantendo a identidade do Prometeus Cadence. É uma divergência visual escolhida em relação ao CadenceFlow e deve ser preservada.

## O que mudou
- Duas colunas fixas na altura da tela (lista de conversas e conversa), cada uma com rolagem própria; a página não rola inteira.
- No celular (até 760 px) aparece uma coluna por vez: a lista, ou a conversa com seta de voltar.
- A conversa abre nas mensagens mais recentes. Bolhas recebidas à esquerda e enviadas à direita, com horário e estado de entrega discretos (relógio, ✓, ✓✓, ✓✓ azul para lida, alerta para falha/incerto/bloqueado) e separador por dia.
- As mensagens antigas carregam ao rolar até o topo (ou pelo botão), com o cursor que já existia, sem perder a posição de leitura. Um botão leva de volta às mais recentes.
- A atualização ao vivo e o botão Atualizar mesclam só a página mais recente; as páginas antigas já carregadas continuam na tela.
- Compositor fixo no rodapé, com seletor de emoji (lista própria, sem dependência nova), Enter envia e Shift+Enter quebra linha.
  O envio continua passando por preparar e confirmar no servidor (autorização, janela de 24 h, limites do OpenWA). Quando o servidor aponta um bloqueio, ou a confirmação falha, abre a revisão; a nova tentativa reaproveita o mesmo comando preparado.
- O painel do Agente SDR fica numa faixa entre o histórico e o compositor, com altura máxima e rolagem própria.
- Vínculo, autorização e bloqueio do contato saíram do corpo da conversa para um modal (ícone de engrenagem no cabeçalho).

## Pendências desta entrega
- Suítes de integração de mensagens e SDR e a conferência no build de produção (`cadence-prod`) ainda não foram executadas nesta sessão.
