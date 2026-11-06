"use client";
import { SelectField } from "@/components/ui/select-field";
import { useState,useRef } from "react";
import { useIdentity, type IdentityView } from "@/client/workspace-provider";
import { useShellBilling } from "@/client/use-shell-billing";
import { getPlan } from "@/domain/billing";
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
  const billing = useShellBilling(data?.activeWorkspaceId??null);
  const seatLimit = billing ? billing.capacity?.seats??getPlan('essential').capacity.seats : null;
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("operator");
  const [busy, setBusy] = useState(false);
  const requests=useRef(new Map<string,string>());
  const run = useAction();
  const me = data?.workspaces.find(
    (w) => w.id === data.activeWorkspaceId,
  )?.role;
  const pendingSeats = me==='operator' ? billing?.usage.pendingSeats??data?.invitations.length??0 : data?.invitations.length??0;
  async function refresh(){const response=await fetch('/api/identity',{cache:'no-store',headers:{'x-cadence-workspace':data!.activeWorkspaceId!}});if(!response.ok)throw Error('Não foi possível atualizar os membros.');setData(await response.json());}
  async function act(body: Record<string,unknown>) {
    if (busy) return false;
    setBusy(true);
    const ok = await run(async () => {
      const key=JSON.stringify(body),requestId=requests.current.get(key)??crypto.randomUUID();requests.current.set(key,requestId);
      await identityPost({...body,requestId}, data?.activeWorkspaceId ?? undefined);
      const response = await fetch("/api/identity", {
        cache: "no-store",
        headers: { "x-cadence-workspace": data!.activeWorkspaceId! },
      });
      if (!response.ok) throw Error("Não foi possível atualizar os membros.");
      setData(await response.json());requests.current.delete(key);
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
      {data&&<div className="members-status row between"><Badge><Icon name="Users" size={13}/> {data.members.length+pendingSeats} de {seatLimit??'—'} assentos</Badge><Button disabled={busy} onClick={()=>void run(refresh,'Membros atualizados.')}>Atualizar membros</Button></div>}
      <section className="settings-reference-panel">
        <header className="settings-reference-panel-head"><span className="settings-reference-symbol"><Icon name="Users" size={20}/></span><div><h2>Convidar</h2><p>A pessoa recebe um e-mail com o link de acesso, válido por 7 dias.</p></div></header>
        <form className="settings-reference-panel-body members-invite-form" onSubmit={async e=>{e.preventDefault();if(await act({type:"invite",email,role}))setEmail("");}}>
          <Field label="E-mail"><input type="email" placeholder="colega@empresa.com.br" required disabled={!data||me==="operator"||busy} value={email} onChange={e=>setEmail(e.target.value)}/></Field>
          {me==="owner"&&<Field label="Papel"><SelectField value={role} disabled={busy} onChange={e=>setRole(e.target.value)}><option value="operator">Operador</option><option value="admin">Administrador</option></SelectField></Field>}
          <Button icon="Plus" variant="primary" disabled={!data||me==="operator"||busy||!email.trim()}>{busy?"Convidando…":"Convidar"}</Button>
        </form>
      </section>
      <section className="settings-reference-panel"><header className="settings-reference-panel-head"><span className="settings-reference-symbol"><Icon name="Users" size={20}/></span><div><h2>Quem tem acesso</h2><p>Membros e permissões do workspace.</p></div></header><div className="settings-reference-panel-body">
      {!data ? (
        <Notice>Convites estão disponíveis no modo autenticado.</Notice>
      ) : data.members.length===1&&data.invitations.length===0?(
        <div className="members-empty"><Icon name="Users" size={20}/><strong>Só você por enquanto</strong><p>Convide alguém do time pelo formulário acima.</p></div>
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
                      {me !== "owner" ? (
                        <Badge>{labels[m.role]}</Badge>
                      ) : (
                        <SelectField
                          aria-label={`Papel de ${m.name}`}
                          value={m.role}
                          disabled={busy||(m.role==='owner'&&data.members.filter(v=>v.role==='owner').length===1)}
                          onChange={(e) =>
                            void act({
                              type: "role",
                              memberId: m.id,
                              role: e.target.value,
                              expectedRevision:m.revision,
                            })
                          }
                        >
                          <option value="operator">Operador</option>
                          <option value="admin">Administrador</option>
                          <option value="owner">Proprietário</option>
                        </SelectField>
                      )}
                    </td>
                    <td>
                      {(me === "owner"&&(m.role!=='owner'||data.members.filter(v=>v.role==='owner').length>1) ||
                          (me === "admin" && m.role === "operator")) && (
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void act({ type: "remove", memberId: m.id,expectedRevision:m.revision })
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
            Os convites pendentes também ocupam assentos do plano. Se outra pessoa alterar o time, atualize os membros antes de tentar novamente.
          </Notice>
        </>
      )}
      </div></section>
    </div>
  );
}
