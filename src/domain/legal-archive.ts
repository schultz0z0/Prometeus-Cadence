// First pilot publication. Preserve exact content accepted by the first local QA registration.
export const legalArchive = {
 'homologacao-2026-10-26': {
  terms: [
   ['Ambiente de homologação','Este documento provisório descreve o piloto do Prometeus Cadence. Não representa os termos definitivos de uma oferta comercial. Use somente dados e destinatários autorizados para validação.'],
   ['Conta e acesso','Confirme seu e-mail, proteja suas credenciais e escolha um workspace. Cada membro acessa os dados conforme seu papel. O telefone informado é um contato de cadastro; o preenchimento não conecta WhatsApp nem autoriza disparos.'],
   ['Plano e operações','Criar a conta não inicia assinatura nem teste. O teste disponível é de 7 dias, sem cobrança automática. Ativar plano, conectar canais, comprar créditos e confirmar envios são ações separadas. Na homologação, pagamentos usam Stripe em ambiente de teste.'],
   ['Integrações','Conexões dependem das permissões e disponibilidade dos provedores. OpenWA é uma integração não oficial e apresenta risco de bloqueio ou banimento mesmo com baixo volume. Limites do aplicativo não garantem proteção.'],
   ['Documentos definitivos','Antes de uso comercial, o responsável pelo produto deve publicar a identificação do fornecedor, canais de atendimento e condições definitivas. Solicitações sobre o piloto devem ser encaminhadas ao responsável que forneceu seu acesso.'],
  ],
  privacy: [
   ['Aviso provisório de homologação','Este aviso próprio descreve o tratamento realizado no piloto. A identificação formal do responsável, canal público para solicitações, prazos e condições comerciais ainda precisam ser publicados antes da oferta comercial.'],
   ['Dados de cadastro','O aplicativo registra nome, e-mail, telefone, verificação de e-mail, senha protegida por hash, sessões e versão/data do aceite destes documentos. O aceite registra ciência destes textos; não autoriza marketing, conexão de canais ou envio a contatos.'],
   ['Dados de operação','Workspaces guardam contatos, listas, cadências, mensagens, resultados, configurações e registros das operações realizadas. O acesso depende do workspace e do papel do membro. Integrações recebem os dados necessários às ações solicitadas, conforme o serviço conectado.'],
   ['Serviços e armazenamento no piloto','A configuração local usa PostgreSQL e serviços em Docker. Os e-mails de autenticação são capturados localmente. Pagamentos de homologação usam Stripe em teste. Canais e provedores de IA conectados podem transmitir dados nas operações explicitamente confirmadas.'],
   ['Controle e solicitações','Você pode encerrar a sessão e gerenciar conexões nas configurações. Não há promessa de eliminação automática de todos os registros neste piloto. Para consultar, corrigir, exportar ou solicitar exclusão de dados, contate o responsável que forneceu seu acesso; funcionalidades ainda pendentes não substituem esse atendimento.'],
  ],
 },
} as const;
