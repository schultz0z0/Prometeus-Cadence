"use client";
import { useState } from "react";
import { useIdentity, type IdentityView } from "@/client/workspace-provider";
import { identityPost } from "@/modules/auth/workspace";
import { useAction } from "@/demo/provider";
import {
  Button,
  Field,
  Notice,
  Modal,
  Badge,
} from "@/components/ui/primitives";
const labels: Record<string, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  operator: "Operador",
};
export function Members() {
  const initial = useIdentity();
  const [data, setData] = useState<IdentityView | null>(initial);
  const [show, setShow] = useState(false);
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
      await identityPost(body);
      const response = await fetch("/api/identity", { cache: "no-store" });
      if (!response.ok) throw Error("Não foi possível atualizar os membros.");
      setData(await response.json());
    }, "Workspace atualizado.");
    setBusy(false);
    return ok;
  }
  return (
    <>
      <div className="row between">
        <h1>Membros</h1>
        <Button
          icon="Plus"
          disabled={!data || me === "operator" || busy}
          onClick={() => setShow(true)}
        >
          Convidar membro
        </Button>
      </div>
      <p className="subtitle">
        Quem tem acesso ao workspace e o que cada pessoa pode fazer.
      </p>
      {!data ? (
        <Notice>Convites estão disponíveis no modo autenticado.</Notice>
      ) : (
        <>
          <div className="panel section-gap">
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
                <Badge>Pendente · 48 horas</Badge>
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
      {show && (
        <Modal title="Convidar membro" onClose={() => setShow(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act({ type: "invite", email, role })) {
                setShow(false);
                setEmail("");
              }
            }}
          >
            <Field label="E-mail do convidado">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Papel">
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="operator">Operador</option>
                {me === "owner" && <option value="admin">Administrador</option>}
              </select>
            </Field>
            <div className="form-actions">
              <Button type="button" onClick={() => setShow(false)}>
                Cancelar
              </Button>
              <Button variant="primary" disabled={busy}>
                Enviar convite local
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
