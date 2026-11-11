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
      "Qualquer nicho que você descrever; a busca descarta o que não é site de empresa.",
    fields: "Traz: nome, site, cidade; e-mail e telefone via qualificação",
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

function SourceMark({source,icon}:{source:Source;icon:string}) {
  if(source==="MAPS")return <svg data-source="MAPS" viewBox="0 0 32 32" width="29" height="29" aria-hidden="true">
    <path d="M16 2a10 10 0 0 0-10 10c0 5 4 7 10 18 6-11 10-13 10-18A10 10 0 0 0 16 2Z" fill="#34a853"/>
    <path d="M6 12A10 10 0 0 1 23 5L10 18c-2-2-4-4-4-6Z" fill="#4285f4"/>
    <path d="M8 6a10 10 0 0 0-2 6c0 2 1 4 2 5l6-6Z" fill="#ea4335"/>
    <path d="m8 17 6-6 5 4-7 8Z" fill="#fbbc04"/>
    <circle cx="16" cy="12" r="4" fill="white"/>
  </svg>;
  if(source==="WEB")return <svg data-source="WEB" viewBox="0 0 32 32" width="29" height="29" aria-hidden="true" fill="none" strokeWidth="5">
    <path d="M5 12A12 12 0 0 1 24 7" stroke="#ea4335"/>
    <path d="M5 12a12 12 0 0 0 0 9" stroke="#fbbc04"/>
    <path d="M5 21a12 12 0 0 0 19 5" stroke="#34a853"/>
    <path d="M24 26a12 12 0 0 0 4-10H16" stroke="#4285f4"/>
  </svg>;
  if(source==="CNPJ")return <svg data-source="CNPJ" viewBox="0 0 32 32" width="29" height="29" aria-hidden="true">
    <rect x="1" y="1" width="30" height="30" rx="6" fill="#009c3b"/>
    <path d="m16 5 11 11-11 11L5 16Z" fill="#ffdf00"/><circle cx="16" cy="16" r="6" fill="#002776"/>
    <path d="M10 15a17 17 0 0 1 12 4" fill="none" stroke="white" strokeWidth="1.4"/>
  </svg>;
  return <Icon name={icon} size={22}/>;
}
export function SourcePicker({
  value,
  onChange,
  extra = false,
}: {
  value: Source;
  onChange: (v: Source) => void;
  extra?: boolean;
}) {
  const opts: (typeof sources[number] & {unavailable?:boolean})[] = extra
    ? [
        sources[0], sources[1],
        {...sources[2],label:'CNPJ por termo',description:'Busca por palavra-chave empresarial.',fields:'Busca por termo em preparação',unavailable:true},
        {...sources[2],label:'CNPJ por CNAE'},
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
        sources[3],
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
          aria-checked={!o.unavailable && value === o.value}
          disabled={o.unavailable}
          title={o.unavailable?'Esta fonte ainda não está disponível':undefined}
          key={o.label}
          className={`source-option ${!o.unavailable && value === o.value ? "selected" : ""}`}
          onClick={() => onChange(o.value)}
        >
          <span className="source-icon">
            <SourceMark source={o.value} icon={o.icon}/>
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
