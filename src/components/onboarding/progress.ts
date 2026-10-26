import type { DemoState } from "../../domain/model.ts";

export interface OnboardingFacts {
  product: boolean | null;
  qualification: boolean | null;
  email: boolean | null;
  whatsapp: boolean | null;
  sent: boolean | null;
  replied: boolean | null;
}
export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  href: string;
  action: string;
  done: boolean;
  checking?: boolean;
}
export const onboardingGroups = [
  { title: "Encontre os leads certos", icon: "Users", ids: ["context", "product", "list", "qualification", "automation", "organized"] },
  { title: "Prepare seus canais", icon: "Radio", ids: ["email", "whatsapp"] },
  { title: "Coloque a prospecção no ar", icon: "Send", ids: ["cadence", "template", "active", "sent"] },
  { title: "Converse e marque reuniões", icon: "MessageSquare", ids: ["notification", "reply"] },
] as const;

export function buildOnboardingSteps(state: DemoState, facts: OnboardingFacts): OnboardingStep[] {
  const list = state.lists.find(item => state.leads.some(lead => lead.listId === item.id));
  const cadence = state.cadences.find(item => !item.archived);
  const cadenceHref = cadence ? `/cadences/${cadence.id}` : "/cadences";
  return [
    { id: "context", title: "A IA já sabe o que você vende", description: "Revise e aprove o contexto da sua empresa para orientar as mensagens.", href: "/settings/context", action: "Revisar contexto", done: !!state.companyProfile.approvedAt },
    { id: "product", title: "Produto cadastrado no contexto", description: "Cadastre o produto ou serviço que você quer apresentar aos leads.", href: "/settings/context", action: "Cadastrar produto", done: facts.product === true, checking: facts.product === null },
    { id: "list", title: list ? `Lista montada: ${state.leads.filter(lead => lead.listId === list.id).length} empresas` : "Monte sua primeira lista", description: "Encontre empresas que combinam com o público que você quer alcançar.", href: list ? `/contacts?list=${encodeURIComponent(list.id)}` : "/leads/generator", action: "Montar uma lista", done: !!list },
    { id: "qualification", title: "Leads avaliados pela IA", description: "Escolha a lista e os módulos do qualificador. Revise a análise antes de usar os resultados.", href: "/leads/qualifier", action: "Qualificar leads", done: facts.qualification === true, checking: facts.qualification === null },
    { id: "automation", title: "Automação criada", description: "Prepare uma busca ou qualificação recorrente para manter a lista atualizada.", href: "/automations", action: "Criar automação", done: state.automations.length > 0 },
    { id: "organized", title: "Contatos organizados", description: "Organize suas empresas em listas para escolher quem entra em cada cadência.", href: "/contacts", action: "Organizar contatos", done: !!list },
    { id: "email", title: "Conecte seu canal de envio", description: "A caixa de e-mail ou o WhatsApp que vai mandar as mensagens e receber as respostas.", href: "/settings/email", action: "Conectar o e-mail", done: facts.email === true || facts.whatsapp === true, checking: facts.email !== true && facts.whatsapp !== true && (facts.email === null || facts.whatsapp === null) },
    { id: "whatsapp", title: "Conecte seu WhatsApp", description: "O número que manda as mensagens da cadência e recebe as respostas. Conecte seu número pelo QR Code ou use a integração oficial.", href: "/settings/whatsapp", action: "Conectar o WhatsApp", done: facts.whatsapp === true, checking: facts.whatsapp === null },
    { id: "cadence", title: "Cadência criada", description: "Monte a sequência de mensagens e revise os intervalos entre os contatos.", href: cadence ? cadenceHref : "/cadences/new", action: "Criar cadência", done: !!cadence },
    { id: "template", title: "Salve uma mensagem pronta", description: "Um template é um texto pronto para reaproveitar nas cadências, com o nome da empresa entrando sozinho.", href: "/templates", action: "Criar um template", done: state.templates.length > 0 },
    { id: "active", title: "Ligue a cadência", description: "Confira as mensagens, os remetentes e os limites antes de revisar a ativação.", href: cadenceHref, action: "Revisar cadência", done: state.cadences.some(item => !item.archived && item.status === "active") },
    { id: "sent", title: "Veja a primeira mensagem sair", description: "Acompanhe a fila e o resultado de cada tentativa. A conclusão considera mensagens aceitas nos últimos 90 dias.", href: "/executions", action: "Ver execuções", done: facts.sent === true, checking: facts.sent === null },
    { id: "notification", title: "Aviso de resposta no seu WhatsApp", description: "Revise a preferência de avisos nas configurações. A preferência salva não comprova a entrega de uma notificação.", href: "/settings/notifications", action: "Configurar avisos", done: state.preferences.notifyWhatsapp },
    { id: "reply", title: "Receba e responda o primeiro lead", description: "Abra as conversas para acompanhar quem respondeu. A conclusão considera respostas recebidas nos últimos 90 dias.", href: "/inbox", action: "Abrir Mensagens", done: facts.replied === true, checking: facts.replied === null },
  ];
}
