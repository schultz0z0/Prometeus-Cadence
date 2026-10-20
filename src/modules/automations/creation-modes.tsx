"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDemo, useRepository, useAction } from "@/demo/provider";
import { Modal, Button, Field, EmptyState } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
export function CreationModes({ onClose }: {
    onClose: () => void;
}) {
    const [mode, setMode] = useState("");
    const s = useDemo();
    const repo = useRepository();
    const run = useAction();
    const router = useRouter();
    return (<Modal wide title={mode === "clone"
            ? "Clonar automação"
            : mode === "models"
                ? "Modelos de automação"
                : "Criar automação"} description="Busque empresas novas ou qualifique uma lista que você já tem." onClose={onClose}>
      {!mode ? (<div className="mode-grid">
          {[
                [
                    "Com IA",
                    "Diga quem você quer alcançar. Compare propostas e revise antes de criar.",
                    "WandSparkles",
                    "/automations/new/ai",
                ],
                [
                    "Modelos",
                    "Buscar no Google Maps ou qualificar uma lista que você já tem.",
                    "Layers",
                    "models",
                ],
                [
                    "Clonar",
                    "Copie uma automação sua e mude só o que precisar.",
                    "Copy",
                    "clone",
                ],
                [
                    "Do zero",
                    "Formulário completo: fonte, filtros, volume, horário e qualificação.",
                    "FileText",
                    "/automations/new",
                ],
            ].map(([title, body, icon, href]) => href.startsWith("/") ? (<Link className="mode-option" href={href} key={title}>
                <div className="mode-art">
                  <span>
                    <Icon name={icon} size={29}/>
                  </span>
                </div>
                <h3>{title}</h3>
                <p>{body}</p>
              </Link>) : (<button key={title} className="mode-option" onClick={() => setMode(href)}>
                <div className="mode-art">
                  <span>
                    <Icon name={icon} size={29}/>
                  </span>
                </div>
                <h3>{title}</h3>
                <p>{body}</p>
              </button>))}
        </div>) : mode === "models" ? (<div className="stack">
          {[
                ["Google Maps · Empresas locais", "MAPS"],
                ["Qualificar novos leads de uma lista", "QUALIFY"],
                ["Buscar empresas por CNAE", "CNPJ"],
            ].map(([label, source]) => (<Link href={`/automations/new?source=${source}`} key={source} className="btn">
              {label}
              <Icon name="ArrowRight" size={16}/>
            </Link>))}
        </div>) : (<div className="stack">
          {s.automations.map((a) => (<button className="panel panel-pad row between" key={a.id} onClick={async () => {
                    if (await run(async () => await repo.saveAutomation({
                        ...structuredClone(a),
                        id: crypto.randomUUID(),
                        name: a.name + " · Cópia",
                        status: "paused",
                        createdAt: new Date().toISOString(),
                    }), "Cópia criada pausada.")) {
                        onClose();
                        router.push("/automations");
                    }
                }}>
              <span>{a.name}</span>
              <Icon name="Copy" size={16}/>
            </button>))}
          {!s.automations.length && (<EmptyState title="Nenhuma automação para clonar" description="Crie sua primeira automação para reutilizá-la depois."/>)}
        </div>)}
      {mode && (<div className="section-gap">
          <Button variant="ghost" onClick={() => setMode("")}>
            Voltar
          </Button>
        </div>)}
    </Modal>);
}
