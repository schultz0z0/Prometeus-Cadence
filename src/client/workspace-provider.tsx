"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useSyncExternalStore,
} from "react";
import type { WorkspaceSnapshot } from "@/domain/workspace";
import { createWorkspaceRepository } from "./workspace-repository";
import { createDraftRecovery } from "./draft-recovery";
import { RepositoryContext, ToastContext } from "@/demo/provider";
import {createProspectingClient,type ProspectingClient} from './prospecting-client';
import {createPlanningClient,type PlanningClient} from './planning-client';
import {createContextClient,type ContextClient} from './context-client';
import {createAutomationClient,type AutomationClient} from './automation-client';
import {createChannelClient,type ChannelClient} from './channel-client';
import {createMessagingClient,type MessagingClient} from './messaging-client';
export interface IdentityView {
  user: { id: string; name: string; email: string };
  activeWorkspaceId: string | null;
  workspaces: { id: string; name: string; role: string }[];
  members: {
    id: string;
    userId: string;
    name: string;
    email: string;
    role: string;
  }[];
  invitations: {
    id: string;
    email: string;
    role: string;
    status: string;
    expiresAt: string;
  }[];
}
const IdentityContext = createContext<IdentityView | null>(null);
const CapabilitiesContext = createContext<string[] | null>(null);
const ProspectingContext=createContext<ProspectingClient|null>(null);
const PlanningContext=createContext<PlanningClient|null>(null);
const CompanyContext=createContext<ContextClient|null>(null);
const RefreshContext=createContext<(()=>Promise<void>)|null>(null);
const AutomationContext=createContext<AutomationClient|null>(null);
const ChannelContext=createContext<ChannelClient|null>(null);
const MessagingContext=createContext<MessagingClient|null>(null);
const RevisionContext=createContext<number|null>(null);
export function useMessaging(){return useContext(MessagingContext);}
export function useWorkspaceRevision(){return useContext(RevisionContext);}
export function useChannels(){return useContext(ChannelContext);}
export function useAutomationClient(){return useContext(AutomationContext);}
export function useWorkspaceRefresh(){return useContext(RefreshContext);}
export function usePlanning(){return useContext(PlanningContext);}
export function useContextClient(){return useContext(CompanyContext);}
export function useProspecting(){return useContext(ProspectingContext);}
export function useIdentity() {
  return useContext(IdentityContext);
}
export function useCapabilities() {
  return useContext(CapabilitiesContext);
}
export function WorkspaceProvider({
  initial,
  identity,
  children,
}: {
  initial: WorkspaceSnapshot;
  identity: IdentityView;
  children: React.ReactNode;
}) {
  const [repo] = useState(() => createWorkspaceRepository(initial));
  const [prospecting]=useState(()=>createProspectingClient({workspaceId:initial.workspaceId,onAccessLost:repo.invalidateAccess}));
  const [planning]=useState(()=>createPlanningClient({workspaceId:initial.workspaceId,onAccessLost:repo.invalidateAccess}));
  const [company]=useState(()=>createContextClient({workspaceId:initial.workspaceId,onAccessLost:repo.invalidateAccess}));
  const [automation]=useState(()=>createAutomationClient({workspaceId:initial.workspaceId,onAccessLost:repo.invalidateAccess}));
  const [channels]=useState(()=>createChannelClient({workspaceId:initial.workspaceId,onAccessLost:repo.invalidateAccess}));
  const [messaging]=useState(()=>createMessagingClient({workspaceId:initial.workspaceId,onAccessLost:repo.invalidateAccess}));
  const current = useSyncExternalStore(
    repo.subscribe,
    repo.snapshot,
    repo.snapshot,
  );
  const access = useSyncExternalStore(repo.subscribe, repo.access, repo.access);
  const [edited] = useState(createDraftRecovery);
  const [toast, setToast] = useState("");
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current) {repo.dispose();prospecting.dispose();planning.dispose();company.dispose();automation.dispose();channels.dispose();messaging.dispose();}
      });
    };
  }, [repo]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const focus = () => {
      void repo.refresh().catch((e) => setToast(e.message));
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [repo]);
  return (
    <IdentityContext value={identity}><ProspectingContext value={prospecting}><PlanningContext value={planning}><CompanyContext value={company}><RefreshContext value={repo.refresh}><AutomationContext value={automation}><ChannelContext value={channels}><MessagingContext value={messaging}><RevisionContext value={current.revision}>
      <CapabilitiesContext value={current.capabilities}>
        <RepositoryContext value={repo}>
          <ToastContext value={setToast}>
            {access.kind === "blocked" ? (
              <main className="auth-content" style={{ minHeight: "100svh" }}>
                <section className="auth-box">
                  <h1>O acesso ao workspace mudou</h1>
                  <p role="alert">{access.message}</p>
                  <p>Os dados anteriores foram retirados desta tela.</p>
                  {edited.size() > 0 && (
                    <details>
                      <summary>
                        Recuperar texto que você estava editando
                      </summary>
                      <textarea
                        aria-label="Texto em edição recuperável"
                        readOnly
                        rows={8}
                        value={edited.text()}
                      />
                    </details>
                  )}
                  <a className="btn primary" href="/dashboard">
                    Abrir o workspace atual
                  </a>
                  <a className="btn" href="/login">
                    Entrar novamente
                  </a>
                </section>
              </main>
            ) : (
              <div
                onChangeCapture={(e) => {
                  edited.capture(e.target as HTMLInputElement);
                }}
              >
                {access.kind === "conflict" && (
                  <div className="error-bar" role="alert">
                    {access.message}{" "}
                    <button className="btn" onClick={() => location.reload()}>
                      Recarregar dados e revisar
                    </button>
                  </div>
                )}
                {children}
              </div>
            )}
            {toast && (
              <div className="toast" role="status">
                {toast}
                {toast.includes("sessão") && (
                  <a href="/login" target="_blank" rel="noreferrer">
                    {" "}
                    Entrar →
                  </a>
                )}
              </div>
            )}
          </ToastContext>
        </RepositoryContext>
      </CapabilitiesContext>
    </RevisionContext></MessagingContext></ChannelContext></AutomationContext></RefreshContext></CompanyContext></PlanningContext></ProspectingContext></IdentityContext>
  );
}
