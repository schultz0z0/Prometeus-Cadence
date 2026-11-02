"use client";
import { useState } from "react";
import { Button, Modal } from "../ui/primitives";
import { Icon } from "../ui/icon";
import { routeTours, type RouteTour } from "@/domain/route-tours";
import { useIdentity } from "@/client/workspace-provider";
import { markTour } from "@/client/assistant-client";
// Read-only walkthrough of one area. Finishing it records an explicit learning mark; it never changes product data.
export function Tour({ onClose, tour = routeTours[0], onComplete }: { onClose: () => void; tour?: RouteTour; onComplete?: () => void }) {
  const identity = useIdentity(), [step, setStep] = useState(0);
  const t = tour.steps[step], last = step === tour.steps.length - 1;
  function finish() {
    const ws = identity?.activeWorkspaceId;
    if (ws) void markTour(ws, tour.id, new AbortController().signal).then(() => onComplete?.()).catch(() => {});
    onClose();
  }
  return (
    <Modal title={t.title} onClose={onClose}>
      <div className="tour-symbol">
        <Icon name={t.icon} size={23} />
        <small>{step + 1} DE {tour.steps.length}</small>
      </div>
      <p>{t.body}</p>
      <div className="tour-example">
        Você só olha durante o passeio; nenhum dado é alterado.
      </div>
      <div className="tour-footer">
        <div className="tour-dots">
          {tour.steps.map((_, i) => (
            <i key={i} className={i <= step ? "filled" : ""} />
          ))}
        </div>
        <div className="row">
          {step > 0 && (
            <Button variant="ghost" icon="ArrowLeft" onClick={() => setStep(step - 1)}>
              Voltar
            </Button>
          )}
          <Button variant="primary" onClick={() => (last ? finish() : setStep(step + 1))}>
            {last ? "Concluir" : "Próximo"}
            <Icon name="ArrowRight" size={16} />
          </Button>
        </div>
      </div>
    </Modal>
  );
}
