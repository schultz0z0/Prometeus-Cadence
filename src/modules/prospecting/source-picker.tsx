"use client";
import type { Source } from "@/domain/model";
import { Icon } from "@/components/ui/icon";
export const sources: {
  value: Source;
  label: string;
  description: string;
  fields: string;
  icon: string;
}[] = [
  {
    value: "MAPS",
    label: "Google Maps",
    description:
      "Empresas com endereço: comércio local e serviços por cidade ou região.",
    fields: "Traz: nome, telefone, site, endereço, nota",
    icon: "MapPin",
  },
  {
    value: "WEB",
    label: "Busca na web",
    description:
      "Busca pública por nicho e localização, com resultados para revisar e qualificar.",
    fields: "Traz: nome, site, cidade; contato via qualificação",
    icon: "Globe",
  },
  {
    value: "CNPJ",
    label: "Base CNPJ",
    description: "Consulta empresarial por CNAE, cidade e estado, conforme o provedor conectado.",
    fields: "Traz: razão social, CNPJ, sócios, endereço, telefone",
    icon: "Database",
  },
  {
    value: "APOLLO",
    label: "Apollo",
    description:
      "Empresas por palavra-chave e localização no banco do Apollo.",
    fields: "Conecte a sua conta em Configurações › CRM e apps",
    icon: "Target",
  },
];
export function SourcePicker({
  value,
  onChange,
  extra = false,
}: {
  value: Source;
  onChange: (v: Source) => void;
  extra?: boolean;
}) {
  const opts = extra
    ? [
        ...sources,
        {
          value: "QUALIFY" as const,
          label: "Qualificar lista",
          description:
            "Qualifica os leads pendentes de uma lista que já existe.",
          fields: "Enriquece e qualifica os leads que você já tem",
          icon: "ListChecks",
        },
        {
          value: "REENGAGE" as const,
          label: "Reengajamento",
          description:
            "Quem concluiu uma cadência sem responder vai para outra lista.",
          fields: "Organiza a próxima tentativa de contato",
          icon: "RefreshCw",
        },
      ]
    : sources;
  return (
    <div
      className="source-picker"
      role="radiogroup"
      aria-label="Fonte de busca"
    >
      {opts.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === o.value}
          key={o.value}
          className={`source-option ${value === o.value ? "selected" : ""}`}
          onClick={() => onChange(o.value)}
        >
          <span className="source-icon">
            <Icon name={o.icon} size={22} />
          </span>
          <strong>{o.label}</strong>
          <p>{o.description}</p>
          <small>{o.fields}</small>
          <span className="radio-indicator">
            {value === o.value && <Icon name="Check" size={11} />}
          </span>
        </button>
      ))}
    </div>
  );
}
