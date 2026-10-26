"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDemo, useRepository, useAction } from "@/demo/provider";
import { createManualAutomationOperation } from "@/domain/automation";
import { sourceLabels, type Source, type Schedule } from "@/domain/model";
import { SourcePicker } from "@/modules/prospecting/source-picker";
import { CnpjFilters } from "@/modules/prospecting/cnpj-filters";
import { Button, Field, PageHeader, Notice } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import {localDateAt,scheduleV2Schema} from '@/domain/schedule';
import {TermLines} from './term-lines';
import {ScheduleFields} from './schedule-fields';
import {useIdentity} from '@/client/workspace-provider';
export function ManualWizard({
  initialSource = "MAPS",
}: {
  initialSource?: string;
}) {
  const s = useDemo();
  const identity=useIdentity();
  const repo = useRepository();
  const run = useAction();
  const router = useRouter();
  const [operation] = useState(() => createManualAutomationOperation(repo));
  const [submitted, setSubmitted] = useState(false);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState<Source>(
    ["MAPS", "WEB", "CNPJ", "QUALIFY", "REENGAGE", "APOLLO"].includes(
      initialSource,
    )
      ? (initialSource as Source)
      : "MAPS",
  );
  const [filters, setFilters] = useState<Record<string, string>>({
    term: "",
    location: "",
    scope:"list",
  });
  const [limit, setLimit] = useState(150);
  const [destination, setDestination] = useState("new");
  const [list, setList] = useState(s.lists[0]?.id ?? "");
  const [schedule, setSchedule] = useState<Schedule>({
    frequency: "daily",
    time: "07:00",
    timezone: s.preferences.timezone,
    weekdays: [1, 2, 3, 4, 5],
    anchorDate:localDateAt(new Date().toISOString(),s.preferences.timezone),
    monthDay:1,
    intervalDays:1,
  });
  const [dedup, setDedup] = useState(["email", "cnpj"]);
  const names = ["Fonte", "Termos", "Filtros", "Destino", "Agendamento"];
  const canAdvance =
    step === 0
      ? name.trim()
      : step === 1
        ? ["QUALIFY", "REENGAGE"].includes(source) ||
          (filters.term.trim() &&
            (filters.location.trim() || source === "CNPJ"))
        : true;
  async function save() {
    if (
      await run(async () => {
        if(!scheduleV2Schema.safeParse(schedule).success)throw Error('Revise data, fuso, frequência e dias de execução.');
        await operation.confirm(
          {
            name,
            description,
            source,
            status: "paused",
            schedule,
            dailyLimit: limit,
            filters: { ...filters, dedup: dedup.join(",") },
            modules:
              source === "QUALIFY"
                ? ["Qualificação por IA", "Resumo com IA"]
                : [],
            createdAt: new Date().toISOString(),
          },
          destination === "new" ? { name } : list,
        );
      }, "Automação criada pausada.")
    ) {
      setSubmitted(true);
      router.push("/automations");
    }
  }
  return (
    <div className="workflow-reference manual-automation-reference">
      <PageHeader
        title="Nova Automação"
        description="Configure sua automação de prospecção"
        back="/automations"
      />
      <div className="manual-tabs" role="tablist">
        {names.map((x, i) => (
          <button
            role="tab"
            aria-selected={step === i}
            aria-controls="automation-wizard-panel"
            disabled={i>step}
            key={x}
            className={step === i ? "active" : ""}
            onClick={() => {
              if (i < step) setStep(i);
            }}
          >
            <span>{i<step?<Icon name="Check" size={12}/>:i+1}</span>{x}
          </button>
        ))}
      </div>
      <div className="workspace-form">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if(!canAdvance||submitted)return;
            if (step === 4) save();
            else setStep(step + 1);
          }}
        >
          <div className="panel panel-pad stack" id="automation-wizard-panel" role="tabpanel" aria-label={names[step]}>
            {step === 0 ? (
              <>
                <div>
                  <h2>Escolha a fonte de dados</h2>
                  <p className="subtitle">
                    De onde buscar leads automaticamente?
                  </p>
                </div>
                <Field label="Nome da automação *">
                  <input
                    autoFocus
                    required
                    placeholder="Ex.: Prospecção Restaurantes SP"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <Field label="Descrição (opcional)">
                  <input
                    placeholder="Breve descrição do objetivo"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </Field>
                <div className="wizard-source">
                  <SourcePicker extra value={source} onChange={setSource} />
                </div>
                {source === "APOLLO" && (
                  <Notice>
                    Apollo exige uma integração. Escolha outra fonte para montar
                    uma automação local.
                  </Notice>
                )}
              </>
            ) : step === 1 ? (
              <>
                <h2>Termos e Localizações</h2>
                <p className="secondary-text">
                  Defina o que buscar e onde buscar.
                </p>
                {["QUALIFY", "REENGAGE"].includes(source) ? (
                  <Notice>
                    A lista de origem será escolhida na etapa Destino.
                  </Notice>
                ) : (
                  <>
                    <div className="wizard-term-grid"><TermLines label="Termos de busca" placeholder="Ex.: restaurante japonês" value={filters.term} onChange={term=>setFilters({...filters,term})}/><TermLines locations label="Localizações" placeholder="Ex.: São Paulo, SP" value={filters.location} onChange={location=>setFilters({...filters,location})}/></div>
                  </>
                )}
              </>
            ) : step === 2 ? (
              <>
                <h2>Filtros e Deduplicação</h2>
                <Field label="Máximo de leads por execução">
                  <input
                    type="number"
                    min="1"
                    max="500"
                    required
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                  />
                </Field>
                <div>
                  <p className="field-label">Deduplicação</p>
                  {identity?<small>Usa CNPJ e identificador estável da fonte. E-mail e telefone isolados não identificam uma empresa com segurança.</small>:<div className="row wrap">
                    {[
                      ["email", "Por e-mail"],
                      ["cnpj", "Por CNPJ"],
                      ["phone", "Por telefone"],
                    ].map(([key, label]) => (
                      <label className="row" key={key}>
                        <input
                          type="checkbox"
                          checked={dedup.includes(key)}
                          onChange={(e) =>
                            setDedup(
                              e.target.checked
                                ? [...dedup, key]
                                : dedup.filter((x) => x !== key),
                            )
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>}
                </div>
                <Field label="Escopo">
                  <select
                    value={filters.scope ?? "list"}
                    onChange={(e) =>
                      setFilters({ ...filters, scope: e.target.value })
                    }
                  >
                    <option value="list">Dentro da lista destino</option>
                    <option value="workspace">
                      Todas as listas do workspace
                    </option>
                  </select>
                </Field>
                {source === "CNPJ" && (
                  <CnpjFilters value={filters} onChange={setFilters} />
                )}
              </>
            ) : step === 3 ? (
              <>
                <h2>Listas de Destino</h2>
                <p className="secondary-text">Onde salvar os leads gerados?</p>
                <div className="row">
                  <Button
                    type="button"
                    variant={destination === "new" ? "soft" : ""}
                    onClick={() => setDestination("new")}
                  >
                    Criar automaticamente
                  </Button>
                  <Button
                    type="button"
                    variant={destination === "existing" ? "soft" : ""}
                    onClick={() => setDestination("existing")}
                  >
                    Usar lista existente
                  </Button>
                </div>
                {destination === "new" ? (
                  <Notice>
                    Uma lista com o nome “{name}” será criada na confirmação.
                  </Notice>
                ) : (
                  <Field label="Lista existente">
                    <select
                      value={list}
                      onChange={(e) => setList(e.target.value)}
                    >
                      {s.lists.map((l) => (
                        <option value={l.id} key={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </>
            ) : (
              <>
                <h2>Agendamento</h2>
                <p className="secondary-text">Quando executar a automação?</p>
                <ScheduleFields value={schedule} onChange={setSchedule}/>
                <Notice>
                  Esta automação será criada pausada. A recorrência real depende
                  do serviço de execução.
                </Notice>
              </>
            )}
          </div>
          <div className="form-actions">
            <Button
              type="button"
              onClick={() =>
                step === 0 ? router.push("/automations") : setStep(step - 1)
              }
              icon="ArrowLeft"
            >
              {step === 0 ? "Cancelar" : "Voltar"}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={submitted || !canAdvance}
            >
              {step === 4 ? "Criar automação pausada" : "Próximo"}
              <Icon name="ArrowRight" size={16} />
            </Button>
          </div>
        </form>
        <aside className="wizard-summary" aria-label="Resumo da automação">
          <small>RESUMO</small>
          {[
            ['Fonte', sourceLabels[source]],
            ["Termos", filters.term || "a definir"],
            ["Filtros", `até ${limit} leads por execução`],
            [
              "Destino",
              destination === "new"
                ? "Nova lista criada pela automação"
                : (s.lists.find((l) => l.id === list)?.name ?? ""),
            ],
            ["Agendamento", `${schedule.frequency} · ${schedule.time}`],
          ].map(([title, body], i) => (
            <button type="button" className={`summary-step ${step===i?'active':''}`} key={i} disabled={i>step} onClick={()=>setStep(i)} aria-current={step===i?'step':undefined}>
              <span>{i + 1}</span>
              <div>
                <strong>{title}</strong>
                <small>{body}</small>
              </div>
            </button>
          ))}
          <p className="summary-foot">
            Diária de manhã dá tempo de a qualificação terminar antes do horário
            de envio das cadências.
          </p>
        </aside>
      </div>
    </div>
  );
}
