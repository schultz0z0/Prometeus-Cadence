"use client";
import { useState } from "react";
import { Button, Field, Modal } from "./primitives";
export function PeriodSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [custom, setCustom] = useState(false);
  return (
    <>
      <div className="period-selector">
        {["Hoje", "7 dias", "30 dias", "90 dias", "Personalizado"].map((v) => (
          <button
            key={v}
            className={value === v ? "selected" : ""}
            aria-pressed={value === v}
            onClick={() =>
              v === "Personalizado" ? setCustom(true) : onChange(v)
            }
          >
            {v}
          </button>
        ))}
      </div>
      {custom && (
        <Modal title="Período personalizado" onClose={() => setCustom(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              if (String(data.get("start")) > String(data.get("end"))) return;
              onChange("Personalizado");
              setCustom(false);
            }}
          >
            <div className="field-grid">
              <Field label="De">
                <input type="date" name="start" required />
              </Field>
              <Field label="Até">
                <input type="date" name="end" required />
              </Field>
            </div>
            <div className="form-actions">
              <Button variant="primary" type="submit">
                Aplicar período
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
