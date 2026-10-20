"use client";
import { createContext, useContext, useEffect, useState, useRef,useSyncExternalStore } from "react";
import type { WorkspaceSnapshot } from "@/domain/workspace";
import { createWorkspaceRepository } from "./workspace-repository";
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
  const current=useSyncExternalStore(repo.subscribe,repo.snapshot,repo.snapshot);
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
            {children}
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
