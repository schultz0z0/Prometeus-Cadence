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
        if (!mounted.current) repo.dispose();
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
    <IdentityContext value={identity}>
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
    </IdentityContext>
  );
}
