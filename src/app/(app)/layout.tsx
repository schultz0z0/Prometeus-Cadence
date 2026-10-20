import { AppShell } from "@/components/shell/app-shell";
import { DemoProvider } from "@/demo/provider";
import {
  WorkspaceProvider,
  type IdentityView,
} from "@/client/workspace-provider";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireIdentity, requirePrincipal } from "@/server/auth/principal";
import { identitySnapshot } from "@/server/workspaces/service";
import { readWorkspaceSnapshot } from "@/server/workspaces/commands";
import { AppError } from "@/server/errors";
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (process.env.APP_DATA_MODE === "demo")
    return (
      <DemoProvider>
        <div className="one-time-note">
          Modo demonstrativo · dados fictícios salvos neste navegador.
        </div>
        <AppShell>{children}</AppShell>
      </DemoProvider>
    );
  const h = await headers();
  let principal;
  try {
    await requireIdentity(h);
    principal = await requirePrincipal(h);
  } catch (e) {
    if (e instanceof AppError && e.status === 401) redirect("/login");
    if (e instanceof AppError && e.status === 403)
      redirect("/onboarding/workspace");
    throw e;
  }
  const [initial, identity] = await Promise.all([
    readWorkspaceSnapshot(principal),
    identitySnapshot(h),
  ]);
  initial.data.preferences.accountName = identity.user.name;
  return (
    <WorkspaceProvider
      key={initial.workspaceId}
      initial={initial}
      identity={identity as unknown as IdentityView}
    >
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
