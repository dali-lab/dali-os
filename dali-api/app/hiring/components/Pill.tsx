import {
  STATUS_PILL_BASE,
  STATUS_COLORS,
  STATUS_LABELS,
  DECISION_COLORS,
  INTERVIEW_STATUS_COLORS,
  INTERVIEW_STATUS_LABELS,
  RECOMMENDATION_COLORS,
} from "~/hiring/lib/labels";
import { cn } from "~/lib/cn";

// Typed pill helpers over the shared color/label maps in labels.ts, so callers
// render a status the same way everywhere without reaching for the raw maps or
// hand-rolling `bg-*-100 text-*-700` strings. New hiring UI should reach for
// these rather than composing STATUS_PILL_BASE by hand.

export function Pill({
  color,
  children,
  className,
}: {
  color?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(STATUS_PILL_BASE, color ?? "bg-muted text-foreground/80", className)}>
      {children}
    </span>
  );
}

export function CycleStatusPill({ status }: { status: string }) {
  return (
    <Pill color={STATUS_COLORS[status]}>{STATUS_LABELS[status] ?? status}</Pill>
  );
}

export function DecisionPill({
  type,
  label,
}: {
  type: string;
  label?: string;
}) {
  return <Pill color={DECISION_COLORS[type]}>{label ?? type}</Pill>;
}

export function InterviewStatusPill({ status }: { status: string }) {
  return (
    <Pill color={INTERVIEW_STATUS_COLORS[status]}>
      {INTERVIEW_STATUS_LABELS[status] ?? status}
    </Pill>
  );
}

export function RecommendationPill({ value }: { value: string }) {
  return <Pill color={RECOMMENDATION_COLORS[value]}>{value}</Pill>;
}
