// Local help center: own content, read by the assistant and the help modal. Keywords are accent-free and lowercase.
export interface HelpArticle{id:string;title:string;href:string;routes:string[];keywords:string[];body:string}
export const helpArticles:HelpArticle[]=[
 {id:'email-connect',title:'Conectar uma caixa de e-mail',href:'/settings/email',routes:['/settings/email','/messages/email'],keywords:['gmail','outlook','e-mail','email','caixa','smtp','imap','remetente'],
  body:'Em Configurações › Contas de e-mail, conecte o Gmail pelo login do Google ou outra caixa por SMTP/IMAP. A caixa só envia depois que o envio e a leitura forem verificados; até lá as cadências de e-mail ficam esperando.'},
 {id:'whatsapp-connect',title:'Conectar o WhatsApp',href:'/settings/whatsapp',routes:['/settings/whatsapp','/messages/whatsapp'],keywords:['whatsapp','zap','qr code','qrcode','numero','meta','openwa','celular'],
  body:'Em Configurações › WhatsApp, conecte seu número pelo QR Code (OpenWA gerenciado) ou pela integração oficial da Meta. Pelo QR Code o envio respeita até 20 mensagens e 5 contatos novos por dia, com intervalo entre envios.'},
 {id:'cadence-not-sent',title:'Por que minha cadência não enviou',href:'/cadences',routes:['/cadences','/executions'],keywords:['nao saiu','nao enviou','nao envia','parada','pausada','travada','nao disparou','cadencia nao'],
  body:'Uma cadência só envia quando está ligada, tem um canal pronto, leads na lista e está dentro da janela de envio e dos limites diários. Abra Execuções para ver o motivo de cada tentativa e a cadência para conferir remetentes e agenda.'},
 {id:'cadence-create',title:'Criar uma cadência',href:'/cadences/new',routes:['/cadences'],keywords:['criar cadencia','nova cadencia','sequencia','etapas','toques','regua'],
  body:'Em Disparos em Massa › Cadências, crie do zero, a partir de um modelo ou com a IA. A cadência nasce como rascunho; você revisa as mensagens, os intervalos e os remetentes antes de ligar.'},
 {id:'plan-limits',title:'Plano, teste e limites',href:'/settings/plan',routes:['/settings/plan'],keywords:['plano','limite','limites','teste','trial','gratis','creditos','cobranca','assinatura','pagamento','fatura'],
  body:'Em Configurações › Plano e cobrança você vê o plano, o teste grátis de 7 dias, os créditos de consumo pré-pagos e o uso do período. Os envios e a capacidade seguem o plano ativo.'},
 {id:'import-sheet',title:'Importar uma planilha',href:'/leads/import',routes:['/leads/import','/contacts'],keywords:['importar','planilha','csv','excel','xlsx','subir lista'],
  body:'Em Contatos › Importar, envie um CSV ou XLSX, associe as colunas e revise a prévia. Contatos repetidos na mesma lista são ignorados e você confirma antes de gravar.'},
 {id:'generator',title:'Encontrar empresas no Gerador',href:'/leads/generator',routes:['/leads/generator'],keywords:['gerador','encontrar empresas','buscar empresas','maps','cnpj','prospectar','novos leads','leads novos'],
  body:'No Gerador você busca empresas por Google Maps, CNPJ ou web, ou descreve o público para a IA montar um plano. Cada busca mostra o custo estimado e só roda depois da sua confirmação.'},
 {id:'qualifier',title:'Qualificar leads com IA',href:'/leads/qualifier',routes:['/leads/qualifier'],keywords:['qualificar','qualificacao','qualificador','avaliar leads','fit'],
  body:'No Qualificador você escolhe a lista e os módulos. A IA avalia cada empresa pelo seu contexto e pelas evidências públicas; sem evidência suficiente, o lead fica como pendente em vez de ser aprovado.'},
 {id:'context',title:'Contexto de IA',href:'/settings/context',routes:['/settings/context'],keywords:['contexto','produto','oferta','cliente ideal','empresa','ia escreve'],
  body:'Em Configurações › Contexto de IA você descreve a empresa, a oferta, o cliente ideal e os produtos. A IA só usa o contexto aprovado para escrever mensagens e qualificar leads.'},
 {id:'automations',title:'Automações',href:'/automations',routes:['/automations'],keywords:['automacao','automacoes','toda semana','recorrente','agendar','automatico'],
  body:'Em Automações você repete uma busca ou uma qualificação em agenda. Toda automação nasce pausada e só roda depois que você revisa o limite diário e confirma a ativação.'},
 {id:'replies',title:'Ver e responder respostas',href:'/messages/email',routes:['/messages','/inbox'],keywords:['resposta','respostas','respondeu','responder','conversa','mensagens recebidas'],
  body:'Em Mensagens você vê as conversas por e-mail e WhatsApp. Uma resposta ou opt-out interrompe os próximos envios da cadência para aquele contato.'},
 {id:'executions',title:'Acompanhar execuções',href:'/executions',routes:['/executions'],keywords:['execucao','execucoes','fila','historico de envio','erro de envio','falha'],
  body:'Em Execuções você acompanha a fila e o resultado de cada tentativa de envio, com o motivo quando algo falha ou fica pendente.'},
 {id:'reports',title:'Relatórios',href:'/reports',routes:['/reports'],keywords:['relatorio','relatorios','metricas','taxa','abertura','resultado'],
  body:'Em Relatórios você vê envios, respostas, aberturas e opt-outs por período. Os números contam apenas eventos registrados no seu workspace.'},
 {id:'duplicates',title:'Contatos duplicados',href:'/settings/dados',routes:['/settings/dados'],keywords:['duplicado','duplicados','repetido','fundir','mesclar'],
  body:'Em Configurações › Contatos duplicados você procura contatos com o mesmo CNPJ, e-mail ou telefone e funde cada grupo depois de revisar. A fusão pode ser desfeita por 7 dias.'},
 {id:'privacy',title:'Privacidade e retenção',href:'/settings/privacy',routes:['/settings/privacy'],keywords:['privacidade','lgpd','apagar','retencao','excluir dados'],
  body:'Em Configurações › Privacidade o proprietário define quando o texto das mensagens antigas é apagado. Ligar ou encurtar o prazo exige confirmação digitando APAGAR.'},
 {id:'members',title:'Membros e permissões',href:'/settings/seats',routes:['/settings/seats'],keywords:['membro','membros','convidar','usuario','permissao','equipe','time'],
  body:'Em Configurações › Membros você convida pessoas e escolhe o papel de cada uma. Somente proprietários e administradores gerenciam membros e cobrança.'},
 {id:'dispatch-limits',title:'Limites de disparo',href:'/settings/dispatch-limits',routes:['/settings/dispatch-limits'],keywords:['limite de envio','por dia','janela','horario de envio','intervalo'],
  body:'Em Configurações › Limites de disparo você ajusta quantas mensagens saem por dia e em que horário. Os limites do canal e do plano continuam valendo acima deles.'},
];
const norm=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
export function matchHelp(text:string,route:string,limit=3):HelpArticle[]{
 const q=' '+norm(text).replace(/[^a-z0-9@.\- ]+/g,' ').replace(/\s+/g,' ')+' ';
 return helpArticles.map(a=>({a,score:a.keywords.filter(k=>q.includes(' '+k)).length*3+(a.routes.some(r=>route===r||route.startsWith(r+'/'))?2:0)}))
  .filter(x=>x.score>0).sort((x,y)=>y.score-x.score).slice(0,limit).map(x=>x.a);
}
