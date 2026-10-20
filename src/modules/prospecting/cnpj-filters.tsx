"use client";
import { Field } from "@/components/ui/primitives";
const ufs = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
];
export function CnpjFilters({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const set = (key: string, v: string) => onChange({ ...value, [key]: v });
  return (
    <div className="cnpj-filters">
      <h3>Filtros de extração</h3>
      <div className="row wrap section-gap">
        {[
          ["active", "Apenas ativas"],
          ["email", "Apenas com e-mail"],
          ["phone", "Apenas com telefone"],
          ["noAccountant", "Filtrar e-mails de contabilidade"],
        ].map(([key, label]) => (
          <label className="row" key={key}>
            <input
              type="checkbox"
              checked={
                value[key] !== "false" &&
                (value[key] === "true" ||
                  ["active", "email", "noAccountant"].includes(key))
              }
              onChange={(e) => set(key, String(e.target.checked))}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="field-grid section-gap">
        {[
          ["openedAfter", "Ano abertura (de)", "2020"],
          ["openedBefore", "Ano abertura (até)", "2026"],
          ["includeCnae", "CNAEs obrigatórios", "Ex.: 6201 ou 6201500"],
          ["excludeCnae", "CNAEs excluídos", "Ex.: 6911"],
          [
            "excludeEmail",
            "Excluir e-mails contendo",
            "contabilidade, financeiro",
          ],
          ["excludeDomains", "Domínios excluídos", "gov.br, hotmail.com"],
          ["includeName", "Razão social contém", "Ex.: transportadora"],
          ["excludeName", "Ocultar se contém", "Ex.: unimed"],
        ].map(([key, label, placeholder]) => (
          <Field label={label} key={key}>
            <input
              value={value[key] ?? ""}
              placeholder={placeholder}
              onChange={(e) => set(key, e.target.value)}
            />
          </Field>
        ))}
      </div>
      <div className="section-gap">
        <p className="field-label">Filtrar por estados (UF) · opcional</p>
        <div className="row wrap">
          {ufs.map((uf) => (
            <button
              type="button"
              key={uf}
              className={`chip ${value.states?.split(",").includes(uf) ? "selected" : ""}`}
              onClick={() => {
                const selected = value.states?.split(",").filter(Boolean) ?? [];
                set(
                  "states",
                  (selected.includes(uf)
                    ? selected.filter((x) => x !== uf)
                    : [...selected, uf]
                  ).join(","),
                );
              }}
            >
              {uf}
            </button>
          ))}
        </div>
      </div>
      <div className="field-grid section-gap">
        <Field label="Porte">
          <select
            value={value.size ?? ""}
            onChange={(e) => set("size", e.target.value)}
          >
            <option value="">Todos</option>
            <option>ME</option>
            <option>EPP</option>
            <option>Demais</option>
          </select>
        </Field>
        <Field label="Natureza jurídica">
          <select
            value={value.legal ?? ""}
            onChange={(e) => set("legal", e.target.value)}
          >
            <option value="">Todas</option>
            {[
              "LTDA",
              "EIRELI",
              "SLU",
              "SA Aberta",
              "SA Fechada",
              "Empresário Individual",
              "Cooperativa",
              "Associação Privada",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label="MEI">
          <select
            value={value.mei ?? "Todos"}
            onChange={(e) => set("mei", e.target.value)}
          >
            <option>Todos</option>
            <option>Sem MEI</option>
            <option>Somente MEI</option>
          </select>
        </Field>
        <Field label="Capital mínimo">
          <input
            type="number"
            min="0"
            value={value.minCapital ?? ""}
            onChange={(e) => set("minCapital", e.target.value)}
          />
        </Field>
        <Field label="Capital máximo">
          <input
            type="number"
            min="0"
            value={value.maxCapital ?? ""}
            onChange={(e) => set("maxCapital", e.target.value)}
          />
        </Field>
        <Field label="Bairro">
          <input
            value={value.district ?? ""}
            onChange={(e) => set("district", e.target.value)}
          />
        </Field>
        <Field label="CEP">
          <input
            value={value.zip ?? ""}
            onChange={(e) => set("zip", e.target.value)}
            placeholder="00000-000"
          />
        </Field>
      </div>
      <label className="row section-gap">
        <input
          type="checkbox"
          checked={value.headquarters === "true"}
          onChange={(e) => set("headquarters", String(e.target.checked))}
        />
        Apenas matriz
      </label>
    </div>
  );
}
