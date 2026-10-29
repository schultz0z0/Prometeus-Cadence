"use client";
import { useState } from "react";
import { Button, Field, Modal } from "./primitives";
export function PeriodSelector({
  value,
  onChange,
  extended = false,
}: {
  value: string;
  onChange: (v: string) => void;
  extended?: boolean;
}) {
  const [custom, setCustom] = useState(false);
  const [error,setError]=useState('');
  return (
    <>
      <div className="period-selector">
        {(extended?["Hoje", "7 dias", "15 dias", "30 dias", "60 dias", "90 dias", "Personalizado"]:["Hoje", "7 dias", "30 dias", "90 dias", "Personalizado"]).map((v) => (
          <button
            key={v}
            className={value === v || v==='Personalizado'&&value.includes('/') ? "selected" : ""}
            aria-pressed={value === v || v==='Personalizado'&&value.includes('/')}
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
              const start=String(data.get('start')),end=String(data.get('end'));
              if(start>end||Date.parse(end)-Date.parse(start)>92*86400000){setError('Escolha até 93 dias, com a data final após a inicial.');return;}
              onChange(start+'/'+end);setError('');
              setCustom(false);
            }}
          >
            <div className="field-grid">
              <Field label="De">
                <input type="date" name="start" required defaultValue={value.includes('/')?value.split('/')[0]:''}/>
              </Field>
              <Field label="Até">
                <input type="date" name="end" required defaultValue={value.includes('/')?value.split('/')[1]:''}/>
              </Field>
            </div>
            {error&&<p role="alert">{error}</p>}
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
