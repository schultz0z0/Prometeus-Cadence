"use client";
import Link from "next/link";
import { createContext, useEffect, useRef, useId } from "react";
import { Icon } from "./icon";
export function Button({
  children,
  icon,
  variant = "",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: string;
  variant?: string;
}) {
  return (
    <button {...props} className={`btn ${variant} ${className}`}>
      <>{icon && <Icon name={icon} size={16} />}</>
      {children}
    </button>
  );
}
export function LinkButton({
  href,
  children,
  icon,
  variant = "",
}: {
  href: string;
  children: React.ReactNode;
  icon?: string;
  variant?: string;
}) {
  return (
    <Link href={href} className={`btn ${variant}`}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </Link>
  );
}
export function IconButton({
  icon,
  label,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: string;
  label: string;
}) {
  return (
    <button
      {...props}
      className={`icon-btn ${props.className ?? ""}`}
      aria-label={label}
      title={label}
    >
      <Icon name={icon} />
    </button>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export const FieldLabelContext = createContext<string|undefined>(undefined);

export function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  const id=useId();
  return (
    <label className="field">
      <span id={id}>{label}</span>
      <FieldLabelContext value={id}>{children}</FieldLabelContext>
      {help && <small>{help}</small>}
    </label>
  );
}
export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: React.ReactNode;
  description?: string;
  actions?: React.ReactNode;
  back?: string;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          {back && (
            <Link className="back-link" href={back}>
              <Icon name="ArrowLeft" size={13} />
              Voltar
            </Link>
          )}
          <h1>{title}</h1>
          {description && <p className="subtitle">{description}</p>}
        </div>
        <div className="row wrap">{actions}</div>
      </div>
    </>
  );
}
export function EmptyState({
  icon = "Inbox",
  title,
  description,
  children,
}: {
  icon?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={42} />
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </div>
  );
}
/** Modal dialogs sit in the top layer, above any z-index; a popover joins it and stays visible over them. */
export const showAboveDialogs = (el: HTMLElement | null) => { if (el && !el.matches(":popover-open")) el.showPopover?.(); };
export function Modal({
  title,
  description,
  onClose,
  children,
  wide = false,
  className = "",
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current, opener = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    // showModal moves focus to the dialog; React's autoFocus renders no attribute for it to honor.
    dialog?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    // A button disabled while saving drops the focus to the page; when it is enabled again, the focus goes back.
    let last = document.activeElement as HTMLElement | null;
    const track = (e: FocusEvent) => { last = e.target as HTMLElement; };
    const watch = new MutationObserver(() => { if (last?.isConnected && !last.hasAttribute("disabled") && !dialog?.contains(document.activeElement)) last.focus({ preventScroll: true }); });
    dialog?.addEventListener("focusin", track);
    if (dialog) watch.observe(dialog, { subtree: true, attributes: true, attributeFilter: ["disabled"] });
    // By now React has removed the dialog, so the browser no longer restores the focus by itself.
    return () => { watch.disconnect(); dialog?.removeEventListener("focusin", track); dialog?.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""} ${className}`}
      aria-labelledby={id}
      onCancel={(event)=>{event.preventDefault();onClose();}}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <h2 id={id}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <IconButton icon="X" label="Fechar" onClick={onClose} />
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function Steps({
  items,
  current,
}: {
  items: string[];
  current: number;
}) {
  return (
    <nav className="steps" aria-label="Etapas">
      {items.map((s, i) => (
        <div
          key={s}
          className={`step ${current === i ? "current" : i < current ? "done" : ""}`}
        >
          {i < current ? <Icon name="Check" size={14} /> : <span>{i + 1}</span>}
          {s}
        </div>
      ))}
    </nav>
  );
}
export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
export function Notice({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className={`notice ${tone}`}>
      <Icon
        name={tone === "success" ? "CheckCircle2" : "AlertCircle"}
        size={17}
      />
      <div>{children}</div>
    </div>
  );
}
export function ChannelPills({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="row wrap">
      {[
        ["whatsapp", "WhatsApp", "MessageSquare"],
        ["email", "E-mail", "Mail"],
        ["both", "Os dois", "MessageSquare"],
      ].map(([v, label, icon]) => (
        <button
          key={v}
          className={`pill ${value === v ? "selected" : ""}`}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
        >
          <Icon name={icon} size={15} />
          {label}
        </button>
      ))}
    </div>
  );
}
