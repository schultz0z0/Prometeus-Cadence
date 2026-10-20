"use client";
import Link from "next/link";
import { useState } from "react";
import { useDemo } from "@/demo/provider";
import { eligibleCadenceLeads } from "@/domain/cadence";
import { Badge, PageHeader, EmptyState } from "@/components/ui/primitives";
export function Pipeline() {
  const s = useDemo();
  const [id, setId] = useState("");
  const [status, setStatus] = useState("");
  const [qualification, setQualification] = useState("");
  const c = s.cadences.find((c) => c.id === id);
  const leads = (c ? eligibleCadenceLeads(c, s.leads) : []).filter(
    (l) => !qualification || l.qualification === qualification,
  );
  return (
    <>
      <PageHeader
        title="Pipeline"
        description="Leads em cada etapa da cadência"
      />
      <div className="row wrap pipeline-filters">
        <select
          aria-label="Cadência"
          value={id}
          onChange={(e) => setId(e.target.value)}
        >
          <option value="">Selecione uma cadência</option>
          {s.cadences.map((c) => (
            <option value={c.id} key={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Situação na cadência"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Mostrar: tudo</option>
          <option value="waiting">Aguardando início</option>
          <option value="progress">Em andamento</option>
          <option value="replied">Responderam</option>
          <option value="completed">Concluídos</option>
        </select>
        <select
          aria-label="Qualificação"
          value={qualification}
          onChange={(e) => setQualification(e.target.value)}
        >
          <option value="">Qualificação: todas</option>
          <option value="qualified">Qualificados</option>
          <option value="pending">Pendentes</option>
          <option value="warning">Em alerta</option>
          <option value="disqualified">Desqualificados</option>
        </select>
      </div>
      {c ? (
        <div className="pipeline-board">
          {[
            "Aguardando início",
            ...c.steps.map((st, i) => `${i + 1} · ${st.channel}`),
            "Responderam",
            "Concluídos",
          ].map((column, i) => (
            <section className="pipeline-column" key={column}>
              <div className="row between">
                <strong>{column}</strong>
                <Badge>
                  {i === 0 && (!status || status === "waiting")
                    ? leads.length
                    : 0}
                </Badge>
              </div>
              {i === 0 &&
                (!status || status === "waiting") &&
                leads.map((l) => (
                  <Link
                    key={l.id}
                    href={`/leads/${l.id}`}
                    className="panel pipeline-card"
                  >
                    <h3>{l.name}</h3>
                    <small>{l.email || l.phone || "sem contato"}</small>
                    <Badge>Aguardando</Badge>
                  </Link>
                ))}
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="Columns3"
          title="Selecione uma cadência"
          description="Escolha uma cadência no seletor acima para ver o pipeline."
        />
      )}
    </>
  );
}
