import type { DemoState, CadenceSettings, Lead } from "../domain/model.ts";
export function defaultCadenceSettings(): CadenceSettings {
  return {
    timezone: "America/Sao_Paulo",
    weekdays: [1, 2, 3, 4, 5],
    sendTime: "09:00",
    skipHolidays: true,
    intervalSeconds: [10, 30],
    whatsappIntervalSeconds: [60, 180],
    budgetPercent: null,
    stopOnReply: true,
    stopKeywords: ["não tenho interesse", "remover", "unsubscribe", "pare"],
    bounceLimit: 5,
    acceptedQualifications: ["qualified"],
    distribute: false,
    corporateOnly: false,
    excludeReplied: true,
    alternateContact: false,
    reengage: false,
    pauseOnBounce: true,
    resume: "tomorrow",
  };
}
const now = "2026-10-20T11:24:00.000Z";
export function createSeed(): DemoState {
  const names = [
    "Atlas Contabilidade",
    "Horizonte Contábil",
    "Nobre & Associados",
    "Oliveira Gestão Contábil",
    "Vértice Finanças",
    "Evoluir Contabilidade",
    "Contábil Silva",
    "Escritório Paulista",
    "Figueira Contabilidade",
    "Aliança Consultoria Empresarial",
    "Órbita Consultoria Tributária",
    "Vista Imobiliária",
    "Meridiano Consultoria",
    "Prisma Contabilidade",
    "Parceria Auditores Independentes",
    "Conecta Contabilidade",
    "Aurora Consultoria",
    "Contabilize Digital",
    "Plural Contabilidade",
    "Serra Gestão Contábil",
  ];
  const leads: Lead[] = names.map((name, i) => ({
    id: `lead-${i + 1}`,
    listId: "list-initial",
    name,
    companyName: name.toUpperCase() + " LTDA",
    site: i === 12 || i === 14 ? undefined : `empresa${i + 1}.example`,
    email: i >= 5 && i < 10 ? undefined : `contato@empresa${i + 1}.example`,
    phone:
      i % 4 === 0
        ? undefined
        : `(11) 9${String(72000000 + i * 1186).slice(0, 8)}`,
    city: i > 17 ? "Porto Alegre" : i === 4 ? "Barueri" : "São Paulo",
    state: i > 17 ? "RS" : "SP",
    cnpj: i % 3 === 0 ? `00.000.000/000${(i % 9) + 1}-00` : undefined,
    qualification:
      i === 10 || i === 11
        ? "disqualified"
        : i < 5 || i > 13
          ? "qualified"
          : "pending",
    source: i % 2 === 0 ? "CNPJ" : "MAPS",
    summary:
      "Empresa fictícia de demonstração, usada para explorar a organização dos leads e a criação de cadências.",
    reason:
      i === 10 || i === 11
        ? "O segmento da empresa está fora do perfil definido."
        : i < 5 || i > 13
          ? "Atende empresas e apresenta processos que podem ser automatizados."
          : undefined,
    createdAt: now,
  }));
  return {
    schemaVersion: 1,
    lists: [
      {
        id: "list-initial",
        name: "Primeiros leads · Escritórios de contabilidade",
      },
    ],
    leads,
    automations: [
      {
        id: "auto-qualify",
        name: "Qualificar · Escritórios de contabilidade",
        description:
          "Lê o site de cada empresa nova e marca quem combina com o seu negócio.",
        listId: "list-initial",
        source: "QUALIFY",
        status: "paused",
        schedule: {
          frequency: "daily",
          time: "08:00",
          timezone: "America/Sao_Paulo",
          weekdays: [1, 2, 3, 4, 5],
        },
        dailyLimit: 150,
        filters: {},
        modules: ["Qualificação por IA", "Resumo com IA", "Extrair telefones"],
        createdAt: now,
      },
      {
        id: "auto-search",
        name: "Buscar · Escritórios de contabilidade",
        description:
          "Traz empresas novas para a lista, sem repetir as que já entraram.",
        listId: "list-initial",
        source: "CNPJ",
        status: "paused",
        schedule: {
          frequency: "daily",
          time: "07:00",
          timezone: "America/Sao_Paulo",
          weekdays: [1, 2, 3, 4, 5],
        },
        dailyLimit: 150,
        filters: {
          term: "Escritórios de contabilidade",
          location: "São Paulo, SP",
        },
        modules: [],
        createdAt: now,
      },
    ],
    cadences: [
      {
        id: "cadence-initial",
        name: "Primeira cadência · Escritórios de contabilidade",
        listId: "list-initial",
        status: "draft",
        createdAt: now,
        settings: defaultCadenceSettings(),
        steps: [
          {
            id: "step-1",
            channel: "WHATSAPP",
            delayDays: 1,
            body: "Oi, tudo bem? Aqui é Raphael, da Prometeus. Vi o site da {{nome}} em {{cidade}} e achei que fazia sentido falar com vocês. Ajudamos empresas a automatizar tarefas repetitivas. Faz sentido eu mandar um resumo rápido de como funciona?",
            stopOnReply: true,
          },
          {
            id: "step-2",
            channel: "WHATSAPP",
            delayDays: 2,
            body: "Oi, de novo. Só passando para saber se você chegou a ver minha mensagem sobre a {{nome}}. Podemos conversar por 10 minutos para entender a rotina de vocês?",
            stopOnReply: true,
          },
          {
            id: "step-3",
            channel: "WHATSAPP",
            delayDays: 4,
            body: "Oi! Última mensagem por aqui. Se automatizar os processos não for prioridade agora, sem problema. Se for, é só me responder que eu mando os detalhes. Obrigado pelo tempo.",
            stopOnReply: true,
          },
        ],
      },
    ],
    templates: [],
    companyProfile: {
      id: "company",
      version: 1,
      name: "Prometeus",
      domain: "agenciaprometeus.com.br",
      offer:
        "Automações, integrações e soluções de inteligência artificial para reduzir tarefas repetitivas e ampliar a capacidade das equipes.",
      products:
        "Automações sob medida\nAgentes de IA\nIntegrações de sistemas\nSites e lojas virtuais",
      idealCustomer:
        "Empresas com processos repetitivos ou de alto volume que buscam melhorar sua produtividade.",
      pains:
        "Retrabalho, sistemas desconectados e tempo perdido em tarefas manuais.",
      differentiators:
        "Soluções personalizadas, integradas à rotina do cliente, com aprovações humanas.",
      competitors: "Não informado",
      socialProof: "Não informado",
      sources: "Contexto de exemplo. Revise os dados antes de usar.",
      approvedAt: now,
    },
    preferences: {
      accountName: "Raphael Schultz",
      company: "Prometeus",
      timezone: "America/Sao_Paulo",
      dailyReport: true,
      weeklyReport: true,
      monthlyReport: true,
      billingEmail: "",
      notifyEmail: true,
      notifyWhatsapp: false,
      onboardingHidden: false,
    },
    confirmationResults: {},
    jobs: [],
  };
}
