"use client";
import Link from "next/link";
import { useEffect, useRef, useId } from "react";
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
export function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
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
  title: string;
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
export function Modal({
  title,
  description,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-labelledby={id}
      onCancel={onClose}
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
