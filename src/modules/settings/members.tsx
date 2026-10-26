"use client";
import { useState } from "react";
import { useIdentity, type IdentityView } from "@/client/workspace-provider";
import { identityPost } from "@/modules/auth/workspace";
import { useAction } from "@/demo/provider";
import {
  Button,
  Field,
  Notice,
  Badge,
} from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
const labels: Record<string, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  operator: "Operador",
};
export function Members() {
  const initial = useIdentity();
  const [data, setData] = useState<IdentityView | null>(initial);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("operator");
  const [busy, setBusy] = useState(false);
  const run = useAction();
  const me = data?.workspaces.find(
    (w) => w.id === data.activeWorkspaceId,
  )?.role;
  async function act(body: unknown) {
    if (busy) return false;
    setBusy(true);
    const ok = await run(async () => {
      await identityPost(body, data?.activeWorkspaceId ?? undefined);
      const response = await fetch("/api/identity", {
        cache: "no-store",
        headers: { "x-cadence-workspace": data!.activeWorkspaceId! },
      });
      if (!response.ok) throw Error("Não foi possível atualizar os membros.");
      setData(await response.json());
    }, "Workspace atualizado.");
    setBusy(false);
    return ok;
  }
  return (
    <div className="settings-reference members-reference">
      <h1>Membros</h1>
      <p className="subtitle">
        Pessoas do seu time que operam esta conta. Entram com o próprio login e trabalham nos seus leads e cadências.
      </p>
      <section className="settings-reference-panel">
        <header className="settings-reference-panel-head"><span className="settings-reference-symbol"><Icon name="Users" size={20}/></span><div><h2>Convidar</h2><p>A pessoa recebe um e-mail com o link de acesso, válido por 48 horas.</p></div></header>
        <form className="settings-reference-panel-body members-invite-form" onSubmit={async e=>{e.preventDefault();if(await act({type:"invite",email,role}))setEmail("");}}>
          <Field label="E-mail"><input type="email" placeholder="colega@empresa.com.br" required disabled={!data||me==="operator"||busy} value={email} onChange={e=>setEmail(e.target.value)}/></Field>
          {me==="owner"&&<Field label="Papel"><select value={role} disabled={busy} onChange={e=>setRole(e.target.value)}><option value="operator">Operador</option><option value="admin">Administrador</option></select></Field>}
          <Button icon="Plus" variant="primary" disabled={!data||me==="operator"||busy||!email.trim()}>{busy?"Convidando…":"Convidar"}</Button>
        </form>
      </section>
      <section className="settings-reference-panel"><header className="settings-reference-panel-head"><span className="settings-reference-symbol"><Icon name="Users" size={20}/></span><div><h2>Quem tem acesso</h2><p>Membros e permissões do workspace.</p></div></header><div className="settings-reference-panel-body">
      {!data ? (
        <Notice>Convites estão disponíveis no modo autenticado.</Notice>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>NOME</th>
                  <th>E-MAIL</th>
                  <th>PAPEL</th>
                  <th>AÇÕES</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>{m.email}</td>
                    <td>
                      {m.role === "owner" || me !== "owner" ? (
                        <Badge>{labels[m.role]}</Badge>
                      ) : (
                        <select
                          aria-label={`Papel de ${m.name}`}
                          value={m.role}
                          disabled={busy}
                          onChange={(e) =>
                            void act({
                              type: "role",
                              memberId: m.id,
                              role: e.target.value,
                            })
                          }
                        >
                          <option value="operator">Operador</option>
                          <option value="admin">Administrador</option>
                        </select>
                      )}
                    </td>
                    <td>
                      {m.role !== "owner" &&
                        (me === "owner" ||
                          (me === "admin" && m.role === "operator")) && (
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void act({ type: "remove", memberId: m.id })
                            }
                          >
                            Remover
                          </Button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Convites pendentes</h3>
          {data.invitations.length ? (
            data.invitations.map((i) => (
              <div className="row between panel panel-pad" key={i.id}>
                <span>
                  {i.email} · {labels[i.role]}
                </span>
                <Badge>Pendente · até {new Date(i.expiresAt).toLocaleDateString("pt-BR")}</Badge>
              </div>
            ))
          ) : (
            <p className="muted">Nenhum convite pendente.</p>
          )}
          <Notice>
            Convites deste ambiente ficam no capturador local de e-mails.
          </Notice>
        </>
      )}
      </div></section>
    </div>
  );
}
