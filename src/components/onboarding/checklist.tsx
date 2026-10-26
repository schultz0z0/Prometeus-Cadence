"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAction, useDemo, useRepository } from "@/demo/provider";
import { useChannels, useContextClient, useIdentity, useMail, useProspecting, useWorkspaceRevision } from "@/client/workspace-provider";
import { useMessageMetrics } from "@/client/use-message-metrics";
import { Button, LinkButton, Modal } from "../ui/primitives";
import { Icon } from "../ui/icon";
import { buildOnboardingSteps, onboardingGroups, type OnboardingStep } from "./progress";
import { Tour } from "./tour-dialog";

function useOnboardingSteps() {
  const state = useDemo(), mail = useMail(), channels = useChannels(), context = useContextClient(), prospecting = useProspecting(), revision = useWorkspaceRevision();
  const { metrics, error: metricsError, live } = useMessageMetrics("90 dias");
  const [attempt, setAttempt] = useState(0);
  const [facts, setFacts] = useState<{ product: boolean | null; qualification: boolean | null; email: boolean | null; whatsapp: boolean | null; error: boolean }>({ product: null, qualification: null, email: null, whatsapp: null, error: false });
  useEffect(() => {
    let active = true;
    setFacts({ product: context ? null : !!state.companyProfile.products.trim(), qualification: prospecting ? null : false, email: mail ? null : false, whatsapp: channels ? null : false, error: false });
    void Promise.allSettled([
      context ? context.get().then(value => value.products.some(product => !product.archived)) : Promise.resolve(!!state.companyProfile.products.trim()),
      prospecting ? prospecting.list({ kind: "qualification", state: "completed" }).then(value => value.items.some(job => !job.testFixture && (job.counts.found > 0 || job.counts.inserted > 0 || job.counts.pending > 0))) : Promise.resolve(false),
      mail ? mail.list().then(value => value.some(box => box.state === "ready" && box.sendVerified && box.readVerified)) : Promise.resolve(false),
      channels ? channels.list().then(value => value.some(connection => connection.state === "ready" && connection.senders.some(sender => sender.ready))) : Promise.resolve(false),
    ]).then(results => {
      if (!active) return;
      const value = (index: number) => results[index].status === "fulfilled" ? results[index].value as boolean : null;
      setFacts({ product: value(0), qualification: value(1), email: value(2), whatsapp: value(3), error: results.some(result => result.status === "rejected") });
    });
    return () => { active = false; };
  }, [mail, channels, context, prospecting, revision, attempt, state.companyProfile.products]);
  return {
    steps: buildOnboardingSteps(state, { ...facts, sent: metrics ? metrics.sent > 0 : live ? null : false, replied: metrics ? metrics.replies > 0 : live ? null : false }),
    error: facts.error || !!metricsError,
    retry: () => setAttempt(value => value + 1),
  };
}

function Progress({ steps }: { steps: OnboardingStep[] }) {
  const done = steps.filter(step => step.done).length;
  return <div className="reference-onboarding-progress"><div className="reference-progress-label"><span>{Math.round(done / steps.length * 100)}%</span><span>{done} de {steps.length} etapas</span></div><div className="reference-progress-track" role="progressbar" aria-label="Primeiros passos concluídos" aria-valuenow={done} aria-valuemin={0} aria-valuemax={steps.length}><i style={{ width: `${done / steps.length * 100}%` }} /></div><span className="reference-progress-note"><Icon name={done === steps.length ? "CircleCheck" : "ListChecks"} size={15} />{done === steps.length ? "Todas as etapas verificadas foram concluídas." : `Faltam ${steps.length - done} passos para completar sua preparação.`}</span></div>;
}

function StepRow({ step, index, full, onHelp }: { step: OnboardingStep; index: number; full?: boolean; onHelp: (step: OnboardingStep) => void }) {
  return <div className={`reference-checklist-step${step.done ? " completed" : ""}`}>
    <span className="reference-step-marker" aria-label={step.done ? "Concluído" : step.checking ? "Verificando" : "Pendente"}>{step.done ? <Icon name="Check" size={13} /> : full ? index + 1 : null}</span>
    <div className="reference-step-copy"><h3>{step.title}</h3>{(!step.done || full) && <p>{step.description}</p>}{step.checking && <small>Consultando o estado desta etapa…</small>}{!full && !step.done && <button type="button" className="reference-inline-help" onClick={() => onHelp(step)}><Icon name="CirclePlay" size={13} />Ver como funciona</button>}</div>
    <div className="reference-step-actions">{full && <Button icon="CirclePlay" onClick={() => onHelp(step)}>Como funciona</Button>}<LinkButton href={step.href} variant={step.done ? "" : "primary"}>{step.done ? "Abrir" : step.action}</LinkButton></div>
  </div>;
}

function HelpDialog({ step, onClose }: { step: OnboardingStep; onClose: () => void }) {
  return <Modal title={step.title} onClose={onClose}><div className="stack"><p>{step.description}</p><p className="muted">Abra a tela para conferir os dados e as opções. Configurações, gerações e envios continuam sujeitos à sua revisão e às permissões do workspace.</p><div className="form-actions"><Button onClick={onClose}>Fechar</Button><LinkButton href={step.href} variant="primary">Abrir tela</LinkButton></div></div></Modal>;
}

function HelpCards({ onTour, onGuide, onTeam }: { onTour: () => void; onGuide: () => void; onTeam: () => void }) {
  return <div className="reference-onboarding-help">
    {[{ title: "Veja em 2 minutos", description: "Um passeio pelas telas: da lista à primeira resposta.", icon: "Compass", action: "Ver o passeio", click: onTour, art: "tour" }, { title: "Central de Ajuda", description: "Passo a passo de cada tela, quando você precisar.", icon: "BookOpen", action: "Abrir a Central", click: onGuide, art: "guide" }, { title: "Prefere que a gente monte?", description: "Use este roteiro com sua equipe para preparar o público, conectar os canais e revisar a primeira cadência.", icon: "Users", action: "Falar com o time", click: onTeam, art: "team" }].map(card => <section className="reference-help-card" key={card.art}><div className={`reference-help-art ${card.art}`} aria-hidden="true"><span className="reference-art-orbit" /><span className="reference-art-symbol"><Icon name={card.icon} size={64} /></span><span className="reference-art-mini"><Icon name={card.art === "tour" ? "MousePointer2" : card.art === "guide" ? "CircleHelp" : "MessageCircle"} size={28} /></span></div><div className="reference-help-copy"><h3>{card.title}</h3><p>{card.description}</p></div><Button onClick={card.click}>{card.action}</Button></section>)}
  </div>;
}

function GuideDialog({ onClose, onStep }: { onClose: () => void; onStep: (step: OnboardingStep) => void }) {
  const { steps } = useOnboardingSteps();
  return <Modal title="Central de Ajuda" wide onClose={onClose}><div className="reference-guide-list">{onboardingGroups.map(group => <section key={group.title}><h3>{group.title}</h3>{steps.filter(step => group.ids.some(id => id === step.id)).map(step => <button type="button" key={step.id} onClick={() => onStep(step)}>{step.title}<Icon name="ArrowRight" size={15} /></button>)}</section>)}</div></Modal>;
}

function TeamDialog({ onClose }: { onClose: () => void }) {
  const identity = useIdentity();
  return <Modal title="Prepare a prospecção com sua equipe" onClose={onClose}><div className="stack"><p>Compartilhe os próximos passos com quem administra o workspace. Cada pessoa pode revisar o contexto, as listas e as mensagens antes da ativação.</p>{identity?.members.length ? <ul>{identity.members.map(member => <li key={member.id}>{member.name}</li>)}</ul> : <p className="muted">Gerencie os membros e convites nas configurações do workspace.</p>}<div className="form-actions"><Button onClick={onClose}>Fechar</Button><LinkButton href="/settings/seats">Ver membros</LinkButton></div></div></Modal>;
}

export function DashboardOnboarding() {
  const state = useDemo(), repo = useRepository(), run = useAction();
  const { steps, error, retry } = useOnboardingSteps();
  const [open, setOpen] = useState<string | null>("Prepare seus canais"), [help, setHelp] = useState<OnboardingStep | null>(null), [dialog, setDialog] = useState<"tour" | "guide" | "team" | null>(null);
  if (state.preferences.onboardingHidden) return null;
  return <section className="reference-onboarding" aria-labelledby="dashboard-onboarding-title"><h2 id="dashboard-onboarding-title">Comece a prospectar</h2><p className="reference-onboarding-subtitle">Complete os passos para preparar sua prospecção até a primeira resposta.</p><Progress steps={steps} />
    <div className="reference-onboarding-groups">{onboardingGroups.map((group, groupIndex) => {
      const items = steps.filter(step => group.ids.some(id => id === step.id)), done = items.filter(step => step.done).length, expanded = open === group.title;
      return <section className="reference-onboarding-group" key={group.title}><h3><button type="button" aria-expanded={expanded} aria-controls={`onboarding-group-${groupIndex}`} onClick={() => setOpen(expanded ? null : group.title)}><span className="reference-group-title">{done === items.length && <span className="reference-group-check"><Icon name="Check" size={12} /></span>}{group.title}</span><span className="reference-group-count">{done} de {items.length}</span><Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={16} /></button></h3>{expanded && <div id={`onboarding-group-${groupIndex}`}>{items.map(step => <StepRow key={step.id} step={step} index={steps.indexOf(step)} onHelp={setHelp} />)}</div>}</section>;
    })}</div>
    {error && <p className="reference-onboarding-warning" role="status">Algumas etapas não puderam ser verificadas. <button type="button" onClick={retry}>Tentar novamente</button></p>}
    <HelpCards onTour={() => setDialog("tour")} onGuide={() => setDialog("guide")} onTeam={() => setDialog("team")} />
    <div className="reference-onboarding-hide"><button type="button" onClick={() => void run(() => repo.updatePreferences({ onboardingHidden: true }))}>Esconder estes passos</button></div>
    {help && <HelpDialog step={help} onClose={() => setHelp(null)} />}{dialog === "tour" && <Tour onClose={() => setDialog(null)} />}{dialog === "guide" && <GuideDialog onClose={() => setDialog(null)} onStep={step => { setDialog(null); setHelp(step); }} />}{dialog === "team" && <TeamDialog onClose={() => setDialog(null)} />}
  </section>;
}

export function FirstStepsGuide() {
  const { steps, error, retry } = useOnboardingSteps();
  const [help, setHelp] = useState<OnboardingStep | null>(null), [tour, setTour] = useState(false);
  return <div className="reference-first-steps"><h1>Primeiros passos</h1><p className="subtitle">As tarefas até a primeira resposta de um lead, em quatro blocos. Cada uma leva pra tela certa e mostra como ela funciona; o sistema marca sozinho o que você já fez.</p><Progress steps={steps} /><div className="reference-first-steps-layout"><div><div className="reference-first-steps-list">{steps.map((step, index) => <StepRow key={step.id} step={step} index={index} full onHelp={setHelp} />)}<div className="reference-checklist-step optional"><span className="reference-step-marker">+</span><div className="reference-step-copy"><h3>Conecte seu CRM <small>opcional</small></h3><p>Revise as integrações disponíveis e o estado da conexão antes de compartilhar leads com outro sistema.</p></div><LinkButton href="/settings/apps">Conectar o CRM</LinkButton></div></div><p className="reference-next-level-label">Depois: o CRM e a IA trabalhando por você</p><section className="reference-next-level"><Icon name="Bot" size={24} /><div><h3>Use o workspace pelo Claude ou pelo ChatGPT</h3><p>Confira a disponibilidade do MCP e as permissões para operar sua conta por assistentes.</p><Link href="/settings/mcp">Como funciona o MCP</Link></div><LinkButton href="/settings/plan">Ver em Meu plano</LinkButton></section></div><aside className="reference-first-steps-aside"><h3>Dá pra fazer tudo sozinho.</h3><p>Cada passo leva pra tela certa e mostra como ela funciona.</p><Button icon="Compass" onClick={() => setTour(true)}>Como tudo se liga</Button></aside></div>
    {error && <p role="status">Algumas etapas aguardam verificação. <button type="button" className="text-button" onClick={retry}>Tentar novamente</button></p>}
    <section className="reference-screen-tours"><h2>Conheça cada tela</h2><p>Cada passeio explica o que é cada parte e o que fazer ali. Dá pra rever quantas vezes quiser.</p><div>{[{ title: "Como tudo se liga", body: "A lista, a cadência, o canal, as respostas e as automações.", href: "", icon: "Compass" }, ...onboardingGroups.map(group => ({ title: group.title, body: steps.filter(step => group.ids.some(id => id === step.id)).map(step => step.title).join(" · "), href: steps.find(step => group.ids.some(id => id === step.id))!.href, icon: group.icon })), { title: "Contexto de IA", body: "Sua empresa, o público e os produtos que orientam as mensagens.", href: "/settings/context", icon: "Sparkles" }, { title: "Templates", body: "Textos por canal, variáveis e prévia da mensagem.", href: "/templates", icon: "FileText" }, { title: "Execuções", body: "O resultado de cada ação e o que precisa de revisão.", href: "/executions", icon: "Clock" }, { title: "Configurações: plano, avisos e time", body: "Plano, uso, equipe, notificações e limites de disparo.", href: "/settings/account", icon: "Settings" }].map(item => <article key={item.title}><Icon name={item.icon} size={21} /><div><h3>{item.title}</h3><p>{item.body}</p></div>{item.href ? <LinkButton href={item.href}>Abrir</LinkButton> : <Button onClick={() => setTour(true)}>Ver</Button>}</article>)}</div></section>
    {help && <HelpDialog step={help} onClose={() => setHelp(null)} />}{tour && <Tour onClose={() => setTour(false)} />}
  </div>;
}
