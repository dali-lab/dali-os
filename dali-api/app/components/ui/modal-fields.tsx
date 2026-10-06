// Field scaffolding for record modals (TaskModal, the partner application
// modal). The design's .field-group / .field-row / section rule, so every
// modal lays out its fields the same way.

import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

// Borderless control for a property panel — the row supplies the structure,
// so the control itself stays quiet.
export const PROP_CONTROL =
  "w-full bg-transparent text-sm text-foreground py-1 focus:outline-none disabled:opacity-60";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  // What the field means or why it's empty, under the control rather than
  // inside it.
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="os-field-group">
      <span className="os-field-label">{label}</span>
      {children}
      {hint && <span className="os-field-hint">{hint}</span>}
    </label>
  );
}

// Two fields on one line.
export function FieldPair({ children }: { children: ReactNode }) {
  return <div className="os-field-row">{children}</div>;
}

// A block below the fields — links, attachments, comments — fenced with a rule
// and named in caps.
export function ModalSection({
  title,
  className,
  children,
}: {
  title: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <>
      <div className="os-modal-divider" aria-hidden />
      <div>
        <span className={cn("block", "os-section-header")}>{title}</span>
        <div className={cn("flex flex-col", className)}>{children}</div>
      </div>
    </>
  );
}

// One field in a property panel: a caption stacked over its value.
export function PropRow({
  label,
  hint,
  required = false,
  children,
}: {
  label: string;
  hint?: string;
  // Marks the field as one create mode won't submit without.
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="os-field-group min-w-0">
      <span className="os-field-label">
        {label}
        {required && <span className="os-required-mark">*</span>}
      </span>
      <div className="min-w-0">{children}</div>
      {hint && <span className="os-field-hint">{hint}</span>}
    </div>
  );
}
