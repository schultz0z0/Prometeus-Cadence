"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDemo } from "@/demo/provider";
import { useIdentity } from "@/client/workspace-provider";
import { useShellBilling } from "@/client/use-shell-billing";
import { AccountControls } from "./account-controls";
import {AssistantPanel} from './assistant-panel';
import { navigation, allPages, pageTitle, type NavigationItem } from "./navigation";
import { Icon } from "../ui/icon";
import { Button, IconButton, Modal, LinkButton } from "../ui/primitives";
function activeChild(n:NavigationItem,path:string){return n.children?.find(c=>c.href===path)??n.children?.filter(c=>path.startsWith(c.href+'/')).sort((a,b)=>b.href.length-a.href.length)[0]??(n.label==='Contatos'&&path.startsWith('/leads/')?n.children?.find(c=>c.href==='/contacts'):undefined);}
export function AppShell({ children }: {
    children: React.ReactNode;
}) {
    const { preferences,leads,cadences } = useDemo();
    const identity = useIdentity();
    const billing = useShellBilling(identity?.activeWorkspaceId ?? null);
    const paid = !!billing && ["active", "past_due", "attention", "canceled"].includes(billing.status);
    const planLabel = billing?.plan === "pro" ? "Pro" : "Essential";
    const sidebar = useRef<HTMLElement>(null);
    const menu = useRef<HTMLButtonElement>(null);
    const [smallScreen, setSmallScreen] = useState(false);
    const path = usePathname();
    const navParent=navigation.find(n=>activeChild(n,path))?.label;
    const recordTitle=cadences.find(c=>path==='/cadences/'+c.id)?.name??leads.find(l=>path==='/leads/'+l.id)?.name;
    const integrationName=({"google-sheets":"Google Planilhas",apollo:"Apollo",funnelsflow:"FunnelsFlow CRM",meetflow:"MeetFlow"} as Record<string,string>)[path.split("/").at(-1)??""];
    const [collapsed, setCollapsed] = useState(false);
    const [mobile, setMobile] = useState(false);
    const [groups, setGroups] = useState<string[]>([]);
    const [theme, setTheme] = useState("light");
    const [font, setFont] = useState(16);
    const [search, setSearch] = useState(false);
    const [query, setQuery] = useState("");
    const [info, setInfo] = useState("");
    const closeInfo=useCallback(()=>setInfo(''),[]);
    useEffect(() => {
        const media = matchMedia("(max-width: 760px)");
        const update = () => setSmallScreen(media.matches);
        update();
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, []);
    useEffect(() => {
        if (!mobile)
            return;
        sidebar.current?.querySelector<HTMLElement>("a[href],button:not([disabled]),summary")?.focus();
        const close = () => {
            setMobile(false);
            menu.current?.focus();
        };
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                close();
            }
            if (e.key !== "Tab")
                return;
            const nodes = [
                ...(sidebar.current?.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),summary,input:not([disabled]),select:not([disabled]),textarea:not([disabled])") ?? []),
            ].filter((e) => e.getClientRects().length && getComputedStyle(e).display !== "none");
            const first = nodes[0], last = nodes.at(-1);
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last?.focus();
            }
            else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first?.focus();
            }
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [mobile]);
    useEffect(() => {
        try {
            const p = JSON.parse(localStorage.getItem("cadence-ui") ?? "{}");
            setCollapsed(!!p.collapsed);
            setTheme(p.theme ?? "light");
            setFont(p.typographyVersion === 2 ? (p.font ?? 16) : p.font === 13 ? 14 : p.font === 16 ? 18 : 16);
        }
        catch { }
    }, []);
    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.fontSize = `${font}px`;
    }, [theme, font]);
    function preference(c: boolean, t: string, f: number) {
        setCollapsed(c);
        setTheme(t);
        setFont(f);
        try {
            localStorage.setItem("cadence-ui", JSON.stringify({ collapsed: c, theme: t, font: f, typographyVersion: 2 }));
        }
        catch { }
    }
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "k") {
                e.preventDefault();
                setSearch((v) => !v);
            }
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, []);
    useEffect(() => {
        setMobile(false);
    }, [path]);
    return (<div className={`app-shell ${collapsed ? "collapsed" : ""} ${mobile ? "mobile-open" : ""}`}>
      {mobile && (<button className="sidebar-scrim" aria-label="Fechar menu" onClick={() => setMobile(false)}/>)}
      <aside className="sidebar" ref={sidebar} inert={smallScreen && !mobile} aria-label="Menu principal">
        <Link href="/dashboard" className="brand" aria-label="Prometeus Cadence, início">
          <span className="brand-mark">
            <Icon name="Flame" size={27}/>
          </span>
          <span className="brand-word">
            Prometeus<span>Cadence</span>
          </span>
        </Link>
        <nav className="main-nav">
          {navigation.map((n) => {
            const active = n.href
                ? (path === n.href || path.startsWith(n.href+'/') || (n.label === "Configurações" && path.startsWith("/settings/")))
                : !!activeChild(n,path);
            const expanded = groups.includes(n.label) || active;
            return (<div key={n.label} className="nav-section">
                {n.href ? (<Link title={collapsed ? n.label : undefined} href={n.href} className={`nav-item ${active ? "active" : ""}`}>
                    <Icon name={n.icon} size={20}/>
                    <span>{n.label}</span>
                    {n.requires && <em>{n.requires}</em>}
                  </Link>) : (<>
                    <button className={`nav-item ${active ? "group-active" : ""}`} title={collapsed ? n.label : undefined} onClick={() => {
                        if (collapsed)
                            preference(false, theme, font);
                        setGroups((g) => g.includes(n.label)
                            ? g.filter((x) => x !== n.label)
                            : [...g, n.label]);
                    }}>
                      <Icon name={n.icon} size={20}/>
                      <span>{n.label}</span>
                      {n.requires && <em>{n.requires}</em>}
                      <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={14}/>
                    </button>
                    {expanded && !collapsed && (<div className="subnav">
                        {n.children?.map((c) => (<Link key={c.href} href={c.href} className={activeChild(n,path)?.href === c.href ? "active" : ""}>
                            <Icon name={c.icon} size={15}/>
                            {c.label}
                          </Link>))}
                      </div>)}
                  </>)}
              </div>);
        })}
        </nav>
        <div className="sidebar-bottom">
          <button className="help-link" onClick={() => setInfo("Central de Ajuda")}>
            <Icon name="HelpCircle" size={16}/>
            <span>Central de Ajuda</span>
          </button>
          <Link href="/first-steps" className="help-link onboarding-link"><Icon name="Compass" size={16}/><span>Primeiros passos</span></Link>
          <Link href="/settings/plan" className="btn primary trial"><Icon name={paid ? "CreditCard" : "Sparkles"} size={17}/><span>{paid ? "Gerenciar meu plano" : "Começar o teste grátis"}</span></Link>
          <Link href="/settings/plan" className="help-link plan-link"><Icon name="CreditCard" size={16}/><span>{billing ? billing.status === "active" ? "Plano " + planLabel : billing.status === "past_due" ? "Pagamento pendente" : billing.status === "trial" ? "Teste de 7 dias" : billing.status === "pilot" ? "Piloto local" : billing.status === "attention" ? "Revisar assinatura" : billing.status === "canceled" ? "Assinatura encerrada" : "Teste por ativar" : identity ? "Consultando plano…" : "Demonstração local"}</span></Link>
          {!identity && <Link href="/settings/account" className="profile"><span className="avatar">{preferences.accountName[0] || "P"}</span><span>{preferences.accountName}<small>Workspace de demonstração</small></span></Link>}
          <AccountControls />
        </div>
        <button className="collapse-handle" aria-label="Recolher ou expandir o menu lateral" onClick={() => preference(!collapsed, theme, font)}>
          <Icon name={collapsed ? "ChevronRight" : "ChevronLeft"} size={12}/>
        </button>
      </aside>
      <div className="workspace" inert={smallScreen && mobile}>
        {!paid && <div className="trial-banner"><span>{billing?.status === "trial" ? "Seu teste está ativo. Explore os recursos do seu plano." : billing?.status === "pilot" ? "Você está no piloto local de homologação." : "Você está montando a sua prospecção. Pra ligar, comece o teste grátis de 7 dias."}</span><Link href="/settings/plan">{billing?.status === "trial" || billing?.status === "pilot" ? "Ver meu plano" : "Começar o teste"}</Link></div>}
        <header className="topbar">
          <div className="row">
            <button className="icon-btn mobile-menu" ref={menu} aria-label="Abrir menu" aria-expanded={mobile} onClick={() => setMobile(true)}>
              <Icon name="Menu"/>
            </button>
            {path.startsWith("/settings") ? <nav className="topbar-breadcrumb" aria-label="Localização"><Link href="/settings/account">Configurações</Link><Icon name="ChevronRight" size={13}/><span>{integrationName&&path.startsWith("/settings/apps/")?<><Link href="/settings/apps">CRM e apps</Link><Icon name="ChevronRight" size={13}/>{integrationName}</>:path.endsWith("/plan") ? "Plano e cobrança" : ({ "account": "Conta", "context": "Contexto de IA", "ai": "Provedores de IA", "notifications": "Notificações", "seats": "Membros", "security": "Segurança", "mcp": "MCP", "email": "Contas de e-mail", "whatsapp": "WhatsApp", "dispatch-limits": "Limites de disparo", "dados": "Contatos duplicados", "privacy": "Privacidade", "apps": "CRM e apps", "webhooks": "Webhooks e API" } as Record<string, string>)[path.split("/").at(-1) ?? ""] ?? pageTitle(path)}</span></nav> : navParent ? <nav className="topbar-breadcrumb" aria-label="Localização"><span>{navParent}</span><Icon name="ChevronRight" size={13}/><span>{recordTitle??pageTitle(path)}</span></nav> : <span>{recordTitle??pageTitle(path)}</span>}
            <button className="how-button" onClick={() => setInfo("Como funciona esta área")}>
              <Icon name="Play" size={13}/>
              <span>Como funciona</span>
            </button>
          </div>
          <div className="topbar-actions">
            <button className="global-search" aria-label="Buscar páginas" onClick={() => setSearch(true)}>
              <Icon name="Search" size={15}/>
              <span>Buscar...</span>
              <kbd>Ctrl K</kbd>
            </button>
            <Button variant="primary compact" icon="Sparkles" onClick={() => setInfo("Assistente")}>
              Assistente
            </Button>
            <Button variant="compact support-button" icon="MessageCircle" onClick={() => setInfo("Fale com a gente")}>Fale com a gente</Button>
            <IconButton icon="Bell" label="Notificações" onClick={() => setInfo("Notificações")}/>
            <button className="icon-btn font-button" aria-label="Alternar tamanho do texto" onClick={() => preference(collapsed, theme, font === 16 ? 18 : font === 18 ? 14 : 16)}>
              A<span>A</span>
            </button>
            <IconButton icon={theme === "light" ? "Moon" : "Sun"} label={theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"} onClick={() => preference(collapsed, theme === "light" ? "dark" : "light", font)}/>
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>
      {search && (<Modal title="O que você procura?" onClose={() => {
                setSearch(false);
                setQuery("");
            }}>
          <div className="search-input">
            <Icon name="Search"/>
            <input autoFocus placeholder="Buscar uma página..." value={query} onChange={(e) => setQuery(e.target.value)}/>
          </div>
          <div className="search-results">
            {allPages
                .filter((x) => x.label.toLowerCase().includes(query.toLowerCase()))
                .map((x) => (<Link key={x.href} href={x.href} onClick={() => setSearch(false)}>
                  <Icon name={x.icon}/>
                  {x.label}
                  <Icon name="ArrowRight" size={15}/>
                </Link>))}
          </div>
        </Modal>)}
      {info==='Assistente'&&<AssistantPanel onClose={closeInfo}/>}
      {info && info!=='Assistente' && (<Modal title={info} onClose={() => setInfo("")}>
          {info === "Notificações" ? (<p>O feed de notificações será disponibilizado no marco 06C.3. Acompanhe por enquanto o estado nas áreas de mensagens e execuções.</p>) : (<>
              <p>
                Encontre empresas, qualifique quem combina com o seu negócio e
                monte uma sequência de mensagens.
              </p>
              <p>
                As propostas só são criadas depois da sua confirmação. {identity?'Seus dados ficam no workspace selecionado.':'Você está no modo de demonstração.'}
              </p>
              <LinkButton href="/first-steps" variant="primary" icon="Compass">
                Ver primeiros passos
              </LinkButton>
            </>)}
        </Modal>)}
    </div>);
}
