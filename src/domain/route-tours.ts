// Route tours: own copy describing each area; read-only walkthroughs that never change data.
export interface TourStep{title:string;body:string;icon:string}
export interface RouteTour{id:string;title:string;routes:string[];steps:TourStep[]}
export const routeTours:RouteTour[]=[
 {id:'overview',title:'Como tudo se liga',routes:[],steps:[
  {title:'Como tudo se liga',icon:'Compass',body:'Encontre empresas que podem comprar de você, escreva a mensagem e organize os próximos contatos. Você revisa e confirma antes de ligar.'},
  {title:'O menu, na ordem do trabalho',icon:'Workflow',body:'Contatos guarda as empresas. Disparos em Massa organiza as cadências. Mensagens reúne as respostas. Automações repete o trabalho aprovado.'},
  {title:'Por onde sai: o canal',icon:'MessageSquare',body:'Conecte seus canais nas configurações. Cada remetente precisa estar pronto antes da ativação; o histórico mostra o estado real dos envios.'},
  {title:'Seu próximo passo',icon:'CheckCircle2',body:'Siga o checklist de primeiros passos para revisar o contexto, a lista e sua primeira sequência.'}]},
 {id:'dashboard',title:'O painel',routes:['/dashboard'],steps:[
  {title:'Seus números do período',icon:'LayoutDashboard',body:'Os cartões mostram leads novos, qualificados, mensagens e respostas do período escolhido no seletor.'},
  {title:'O dia de hoje',icon:'Clock',body:'A faixa Hoje conta o que está previsto e o que já saiu desde a meia-noite no fuso do workspace.'},
  {title:'Funil e cadências',icon:'ChartNoAxesColumn',body:'O funil mostra como a qualificação está indo e o bloco de cadências mostra quantos leads estão em cada etapa.'}]},
 {id:'contacts',title:'Contatos',routes:['/contacts','/leads'],steps:[
  {title:'Suas listas',icon:'Users',body:'Cada empresa fica numa lista. Use o seletor para ver todas ou só uma lista, e os filtros para encontrar quem importa.'},
  {title:'Adicionar contatos',icon:'Upload',body:'Adicione um contato à mão, importe uma planilha ou traga empresas do Gerador. Repetidos na mesma lista são ignorados.'},
  {title:'Qualificar e enriquecer',icon:'ListChecks',body:'O Qualificador avalia cada empresa pelo seu contexto, e o Enriquecer procura decisores com fonte pública. Você revisa antes de usar.'}]},
 {id:'generator',title:'Gerador e qualificador',routes:['/leads/generator','/leads/qualifier','/leads/enrich'],steps:[
  {title:'Escolha a fonte',icon:'Sparkles',body:'Busque empresas por Google Maps, CNPJ ou web, ou descreva o público para a IA montar um plano.'},
  {title:'Custo antes de rodar',icon:'Coins',body:'Cada busca mostra a estimativa de uso e só começa depois da sua confirmação.'},
  {title:'Revise o resultado',icon:'ListChecks',body:'Os leads novos entram na lista escolhida e podem ser qualificados com evidências antes de entrar numa cadência.'}]},
 {id:'cadences',title:'Cadências',routes:['/cadences','/templates'],steps:[
  {title:'Uma sequência de toques',icon:'Send',body:'A cadência define quais mensagens saem, por qual canal e com que intervalo para os leads de uma lista.'},
  {title:'Rascunho primeiro',icon:'FileText',body:'Toda cadência nasce como rascunho. Revise os textos, as variáveis e os remetentes antes de pedir a ativação.'},
  {title:'Ligar com revisão',icon:'CheckCircle2',body:'A ativação mostra o que vai sair, os limites do canal e do plano. Nada é enviado antes da sua confirmação.'}]},
 {id:'executions',title:'Execuções',routes:['/executions'],steps:[
  {title:'O histórico de cada ação',icon:'Clock',body:'Cada busca, qualificação e envio aparece aqui com o estado atual e o motivo quando algo falha.'},
  {title:'O que precisa de você',icon:'AlertCircle',body:'Resultados incertos ficam separados para revisão; o sistema não repete um envio cujo resultado não foi confirmado.'},
  {title:'Detalhes',icon:'Eye',body:'Abra uma execução para ver os itens, os custos estimados e as evidências de cada etapa.'}]},
 {id:'messages',title:'Mensagens',routes:['/messages','/inbox'],steps:[
  {title:'Conversas por canal',icon:'Inbox',body:'E-mail e WhatsApp têm caixas separadas, com busca, filtros e o histórico de cada contato.'},
  {title:'Responder com revisão',icon:'MessageSquare',body:'Escreva a resposta, revise o destinatário e a prévia e só então coloque na fila.'},
  {title:'Respostas param a cadência',icon:'Pause',body:'Quando o lead responde ou pede para sair, os próximos toques daquele contato são interrompidos.'}]},
 {id:'automations',title:'Automações',routes:['/automations'],steps:[
  {title:'Trabalho que se repete',icon:'Workflow',body:'Uma automação repete uma busca ou uma qualificação em agenda, sempre dentro do limite diário que você aprovar.'},
  {title:'Nasce pausada',icon:'Pause',body:'Toda automação criada fica pausada até você revisar agenda, limite e custo e confirmar a ativação.'},
  {title:'Acompanhe as rodadas',icon:'History',body:'O histórico mostra cada rodada, o que entrou na lista e o que falhou.'}]},
 {id:'reports',title:'Relatórios',routes:['/reports'],steps:[
  {title:'Indicadores do período',icon:'ChartNoAxesColumn',body:'Envios, respostas, aberturas e opt-outs aparecem por período, contando só eventos registrados no workspace.'},
  {title:'Detalhe por indicador',icon:'Eye',body:'Abra um indicador para ver a série diária e a origem de cada número.'},
  {title:'Exportar',icon:'Download',body:'Exporte os números quando precisar compartilhar fora do aplicativo.'}]},
 {id:'settings',title:'Configurações',routes:['/settings'],steps:[
  {title:'Conta e plano',icon:'CreditCard',body:'Plano, teste grátis, créditos e cobrança ficam em Plano e cobrança.'},
  {title:'Canais',icon:'Mail',body:'Conecte a caixa de e-mail e o WhatsApp. Um canal só envia depois de verificado.'},
  {title:'Time e segurança',icon:'Shield',body:'Convide membros, defina papéis e proteja o acesso com o autenticador.'}]},
];
export const tourIds=new Set(routeTours.map(t=>t.id));
// Longest matching prefix wins, so /leads/generator gets its own tour rather than the contacts one.
export function tourForRoute(path:string):RouteTour{
 return routeTours.flatMap(t=>t.routes.filter(r=>path===r||path.startsWith(r+'/')).map(r=>({t,len:r.length}))).sort((a,b)=>b.len-a.len)[0]?.t??routeTours[0];
}
