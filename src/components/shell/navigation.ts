export type NavigationItem = {
  label: string;
  href?: string;
  icon: string;
  children?: { label: string; href: string; icon: string }[];
  requires?: string;
};
export const navigation: NavigationItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard" },
  {
    label: "Contatos",
    icon: "Users",
    children: [
      { label: "Leads", href: "/contacts", icon: "Users" },
      { label: "Gerador", href: "/leads/generator", icon: "Sparkles" },
      { label: "Enriquecer", href: "/leads/enrich", icon: "UserRoundSearch" },
      { label: "Qualificador", href: "/leads/qualifier", icon: "ListChecks" },
    ],
  },
  {
    label: "Disparos em Massa",
    icon: "Send",
    children: [
      { label: "Cadências", href: "/cadences", icon: "Send" },
      { label: "Pipeline", href: "/cadences/pipeline", icon: "Columns3" },
      { label: "Templates", href: "/templates", icon: "FileText" },
      { label: "Execuções", href: "/executions", icon: "Clock" },
    ],
  },
  {
    label: "LinkedIn",
    icon: "Linkedin",
    requires: "Pro",
    children: [
      {
        label: "Visão geral",
        href: "/linkedin/dashboard",
        icon: "ChartNoAxesColumn",
      },
      { label: "Campanhas", href: "/linkedin/campaigns", icon: "Send" },
      { label: "Pessoas", href: "/linkedin/people", icon: "Users" },
      { label: "Aprovações", href: "/linkedin/approvals", icon: "CheckCheck" },
    ],
  },
  {
    label: "Mensagens",
    icon: "Inbox",
    children: [
      { label: "E-mail", href: "/messages/email", icon: "Mail" },
      { label: "WhatsApp", href: "/messages/whatsapp", icon: "MessageSquare" },
    ],
  },
  { label: "Automações", href: "/automations", icon: "Workflow" },
  { label: "Relatórios", href: "/reports", icon: "ChartNoAxesColumn" },
  { label: "Agente SDR", href: "/sdr", icon: "Bot", requires: "Pro" },
  { label: "Configurações", href: "/settings/account", icon: "Settings" },
];
export const allPages = navigation.flatMap(
  (n) => n.children ?? [{ label: n.label, href: n.href!, icon: n.icon }],
);
export function pageTitle(path: string) {
  if (
    path.startsWith("/leads/") &&
    !["generator", "enrich", "qualifier"].some((x) => path.endsWith(x))
  )
    return "Detalhes do lead";
  return (
    allPages.find((n) => n.href === path)?.label ??
    (path.includes("/automations/new")
      ? "Nova automação"
      : path.includes("/cadences/new")
        ? "Nova cadência"
        : path.startsWith("/cadences/")
          ? "Cadência"
          : path.startsWith("/settings")
            ? "Configurações"
            : "Prometeus Cadence")
  );
}
