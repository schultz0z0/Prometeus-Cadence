"use client";
import Link from "next/link";
import { useState } from "react";
import { useDemo, useRepository, useAction } from "@/demo/provider";
import { settingsGroups } from "./navigation";
import { Account } from "./account";
import { CompanyContext } from "./context";
import { Channels } from "./channels";
import { Integrations } from "./integrations";
import { Plan } from "./plan";
import { Members as WorkspaceMembers } from "./members";
import { Security } from "./security";
import { useIdentity } from "@/client/workspace-provider";
import {
  Button,
  Field,
  Toggle,
  Notice,
  Badge,
  EmptyState,
  LinkButton,
  Modal,
} from "@/components/ui/primitives";
function Notifications() {
  const s = useDemo();
  const repo = useRepository();
  const run = useAction();
  const [p, setP] = useState(s.preferences);
  return (
    <>
      <h1>Notificações</h1>
      <p className="subtitle">Escolha como acompanhar suas novas respostas.</p>
      <section className="settings-section">
        <Toggle
          label="Receber por e-mail"
          description="Novas respostas, erros de canal e resumos."
          checked={p.notifyEmail}
          onChange={(v) => setP({ ...p, notifyEmail: v })}
        />
        <Toggle
          label="Receber no WhatsApp"
          description="Requer um número de avisos configurado."
          checked={p.notifyWhatsapp}
          onChange={(v) => setP({ ...p, notifyWhatsapp: v })}
        />
        <div className="form-actions">
          <Button
            variant="primary"
            onClick={async () =>
              await run(
                async () =>
                  await repo.updatePreferences({
                    notifyEmail: p.notifyEmail,
                    notifyWhatsapp: p.notifyWhatsapp,
                  }),
                "Preferências salvas.",
              )
            }
          >
            Salvar preferências
          </Button>
        </div>
        <Notice>
          Preferências preparadas. O envio será disponibilizado com a integração
          dos canais.
        </Notice>
      </section>
    </>
  );
}
function OtherSettings({ section }: { section: string }) {
  const s = useDemo();
  const identity = useIdentity();
  const titles: Record<string, [string, string, string]> = {
    security: [
      "Segurança",
      "Senha, autenticação e dispositivos da sua conta.",
      "Shield",
    ],
    mcp: [
      "MCP",
      "Acesse o workspace por assistentes com permissões controladas.",
      "Bot",
    ],
    dados: [
      "Contatos duplicados",
      "Confira contatos repetidos antes de mesclar.",
      "Copy",
    ],
    privacy: [
      "Privacidade",
      "Seus dados, supressões e preferências de privacidade.",
      "Lock",
    ],
    webhooks: [
      "Webhooks e API",
      "Conecte outros sistemas aos eventos da sua prospecção.",
      "Link2",
    ],
  };
  const [t, d, icon] = titles[section] ?? titles.security;
  const duplicates =
    section === "dados"
      ? s.leads.filter(
          (l, i, a) => l.email && a.findIndex((x) => x.email === l.email) !== i,
        )
      : [];
  return (
    <>
      <h1>{t}</h1>
      <p className="subtitle">{d}</p>
      {section === "dados" ? (
        <section className="panel section-gap">
          <EmptyState
            icon="Copy"
            title={
              duplicates.length
                ? `${duplicates.length} possíveis duplicatas`
                : "Nenhum contato duplicado por e-mail"
            }
            description={
              duplicates.length
                ? "Revise os perfis antes de mesclar. A mesclagem estará disponível com o backend."
                : "A comparação considera os contatos presentes na base local."
            }
          >
            <LinkButton href="/contacts">Ver contatos</LinkButton>
          </EmptyState>
        </section>
      ) : (
        <section className="panel section-gap">
          <EmptyState
            icon={icon}
            title={
              section === "security"
                ? "Autenticação ainda não integrada"
                : section === "webhooks"
                  ? "Nenhum webhook configurado"
                  : section === "mcp"
                    ? "Nenhum acesso MCP criado"
                    : "Dados locais, sob seu controle"
            }
            description={
              section === "privacy"
                ? identity
                  ? "Os dados são persistidos no PostgreSQL local, com acesso vinculado aos membros da organização."
                  : "Os dados demonstrativos ficam somente neste navegador."
                : `A configuração de ${t.toLowerCase()} exige os serviços de conta e permissões no servidor. Nenhuma credencial é solicitada aqui.`
            }
          />
        </section>
      )}
    </>
  );
}
export function SettingsLayout({ section = "account" }: { section?: string }) {
  return (
    <div
      className={`settings-layout ${section === "context" ? "wide-settings" : ""}`}
    >
      <nav className="settings-nav" aria-label="Configurações">
        {settingsGroups.map((g) => (
          <div key={g.title}>
            <h4>{g.title}</h4>
            {g.items.map(([label, path]) => (
              <Link
                key={path}
                className={section === path ? "active" : ""}
                href={`/settings/${path}`}
              >
                {label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="settings-main" key={section}>
        {section === "account" ? (
          <Account />
        ) : section === "context" ? (
          <CompanyContext />
        ) : ["email", "whatsapp", "dispatch-limits"].includes(section) ? (
          <Channels section={section} />
        ) : section === "apps" ? (
          <Integrations />
        ) : section === "plan" ? (
          <Plan />
        ) : section === "notifications" ? (
          <Notifications />
        ) : section === "seats" ? (
          <WorkspaceMembers />
        ) : section === "security" ? (
          <Security />
        ) : (
          <OtherSettings section={section} />
        )}
      </div>
    </div>
  );
}
