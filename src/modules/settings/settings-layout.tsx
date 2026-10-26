"use client";
import Link from "next/link";
import { useState } from "react";
import { useDemo, useRepository, useAction } from "@/demo/provider";
import { settingsGroups } from "./navigation";
import { Account } from "./account";
import { CompanyContext } from "./context";
import { Channels } from "./channels";
import { NotificationSettings, ReferenceSettings } from "./reference-settings";
import { Integrations } from "./reference-integrations";
import { Plan } from "./plan";
import { Members as WorkspaceMembers } from "./members";
import { Security } from "./security";
import { AiSettings } from "./ai";
import { useIdentity } from "@/client/workspace-provider";
import { Icon } from "@/components/ui/icon";
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
export function SettingsLayout({ section = "account" }: { section?: string }) {
  const [help,setHelp]=useState(false);
  const [area,subpage] = section.split("/");
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
                className={area === path ? "active" : ""}
                href={`/settings/${path}`}
              >
                {label}
              </Link>
            ))}
          </div>
        ))}
        <Button className="settings-guide" onClick={()=>setHelp(true)}><Icon name="CirclePlay" size={13}/>Como funciona esta área</Button>
      </nav>
      <div className="settings-main" key={section}>
        {section === "account" ? (
          <Account />
        ) : section === "ai" ? (
          <AiSettings />
        ) : section === "context" ? (
          <CompanyContext />
        ) : ["email", "whatsapp", "dispatch-limits"].includes(section) ? (
          <Channels section={section} />
        ) : area === "apps" ? (
          <Integrations subpage={subpage} />
        ) : section === "plan" ? (
          <Plan />
        ) : section === "notifications" ? (
          <NotificationSettings />
        ) : section === "seats" ? (
          <WorkspaceMembers />
        ) : section === "security" ? (
          <Security />
        ) : (
          <ReferenceSettings section={section} />
        )}
      </div>
      {help&&<Modal title="Como funciona esta área" onClose={()=>setHelp(false)}><div className="stack"><p>Gerencie sua conta, os membros da equipe e os canais de envio nas configurações.</p><p>Em Meu plano, acompanhe o uso e os limites. A aba Cobrança reúne faturas e contato financeiro; Planos e pacotes permite revisar uma mudança ou adquirir créditos.</p><Button onClick={()=>setHelp(false)}>Entendi</Button></div></Modal>}
    </div>
  );
}
