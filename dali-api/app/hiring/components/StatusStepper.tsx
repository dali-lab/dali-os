import { Check, Minus } from "lucide-react";
import type { DomainApplicationStatus } from "~/types";
import { cn } from "~/lib/cn";

// ── The hiring pipeline, as a stepper ────────────────────────────────────────
// Every application walks the same four-stage funnel: Apply → Review →
// Interview → Decision. This is the one shape the whole hiring area shares — an
// applicant reads it to know where they stand; a reviewer reads it to know how
// far a candidate has travelled. It is driven entirely by the derived
// `DomainApplicationStatus` (see hiring/lib/domain-application-status.ts), so it
// never invents state the backend doesn't already assert.

type StepState = "done" | "current" | "upcoming";
type Outcome = "accepted" | "waitlisted" | "rejected" | "withdrawn" | null;

const STEPS = ["Apply", "Review", "Interview", "Decision"] as const;

// Which step a given status is standing on (0-based index into STEPS).
const STEP_INDEX: Record<DomainApplicationStatus, number> = {
  ApplicationOpen: 0,
  Pending: 1,
  InvitedToInterview: 2,
  InterviewScheduled: 2,
  PostInterviewPending: 2,
  Withdrawn: 2,
  Accepted: 3,
  Rejected: 3,
  Waitlisted: 3,
};

function outcomeOf(status: DomainApplicationStatus): Outcome {
  switch (status) {
    case "Accepted":
      return "accepted";
    case "Waitlisted":
      return "waitlisted";
    case "Rejected":
      return "rejected";
    case "Withdrawn":
      return "withdrawn";
    default:
      return null;
  }
}

// A closed track (a decision landed, or the applicant stepped away) fills its
// current node with the outcome's tone instead of the live-coral "you are here".
const OUTCOME_DOT: Record<Exclude<Outcome, null>, string> = {
  accepted: "border-transparent bg-accent-teal text-white",
  waitlisted: "border-transparent bg-accent-yellow text-navy-deep",
  rejected: "border-transparent bg-muted-foreground/60 text-white",
  withdrawn: "border-transparent bg-muted-foreground/40 text-white",
};

const OUTCOME_LABEL: Record<Exclude<Outcome, null>, string> = {
  accepted: "text-accent-teal",
  waitlisted: "text-navy",
  rejected: "text-muted-foreground",
  withdrawn: "text-muted-foreground",
};

export function StatusStepper({
  status,
  variant = "full",
  className,
}: {
  status: DomainApplicationStatus;
  variant?: "full" | "compact";
  className?: string;
}) {
  const activeIndex = STEP_INDEX[status];
  const outcome = outcomeOf(status);
  const closed = outcome !== null;
  const compact = variant === "compact";

  return (
    <ol
      className={cn("flex w-full items-start", className)}
      aria-label="Application progress"
    >
      {STEPS.map((label, i) => {
        const state: StepState =
          i < activeIndex ? "done" : i === activeIndex ? "current" : "upcoming";
        const isLast = i === STEPS.length - 1;

        // The connector to the *next* node is "filled" once this node is behind us.
        const connectorFilled = i < activeIndex;

        return (
          <li
            key={label}
            className="flex flex-1 flex-col items-center last:flex-none"
            aria-current={state === "current" ? "step" : undefined}
          >
            <div className="flex w-full items-center">
              {/* leading spacer keeps the first node's connector from the edge */}
              {i > 0 && (
                <span
                  className={cn(
                    "h-0.5 flex-1 rounded-full transition-colors",
                    i <= activeIndex ? "bg-accent-teal" : "bg-border",
                  )}
                  aria-hidden
                />
              )}
              <StepDot
                index={i}
                state={state}
                outcome={i === activeIndex ? outcome : null}
                closed={closed}
                compact={compact}
              />
              {!isLast && (
                <span
                  className={cn(
                    "h-0.5 flex-1 rounded-full transition-colors",
                    connectorFilled ? "bg-accent-teal" : "bg-border",
                  )}
                  aria-hidden
                />
              )}
            </div>
            <span
              className={cn(
                "mt-2 font-heading font-semibold",
                compact ? "text-[11px]" : "text-xs sm:text-sm",
                state === "current" && outcome
                  ? OUTCOME_LABEL[outcome]
                  : state === "current"
                    ? "text-accent-coral"
                    : state === "done"
                      ? "text-foreground"
                      : "text-muted-foreground",
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function StepDot({
  index,
  state,
  outcome,
  closed,
  compact,
}: {
  index: number;
  state: StepState;
  outcome: Outcome;
  closed: boolean;
  compact: boolean;
}) {
  const size = compact ? "h-6 w-6 text-[11px]" : "h-8 w-8 text-sm";

  // Done nodes always read as a completed checkmark.
  if (state === "done") {
    return (
      <Dot className={cn(size, "border-transparent bg-accent-teal text-white")}>
        <Check className={compact ? "h-3 w-3" : "h-4 w-4"} aria-hidden />
      </Dot>
    );
  }

  if (state === "current") {
    // A landed outcome (accept/waitlist/reject) or a withdrawal colours the node.
    if (outcome === "withdrawn") {
      return (
        <Dot className={cn(size, OUTCOME_DOT.withdrawn)}>
          <Minus className={compact ? "h-3 w-3" : "h-4 w-4"} aria-hidden />
        </Dot>
      );
    }
    if (outcome) {
      return (
        <Dot className={cn(size, OUTCOME_DOT[outcome])}>
          {outcome === "rejected" ? (
            <Minus className={compact ? "h-3 w-3" : "h-4 w-4"} aria-hidden />
          ) : (
            <Check className={compact ? "h-3 w-3" : "h-4 w-4"} aria-hidden />
          )}
        </Dot>
      );
    }
    // Live "you are here": coral ring with a soft pulse (unless the track is closed).
    return (
      <Dot
        className={cn(
          size,
          "border-accent-coral bg-card text-accent-coral",
          !closed && "ring-4 ring-accent-coral/15",
        )}
      >
        <span className="font-heading font-bold">{index + 1}</span>
      </Dot>
    );
  }

  // upcoming
  return (
    <Dot className={cn(size, "border-border bg-card text-muted-foreground")}>
      <span className="font-heading font-bold">{index + 1}</span>
    </Dot>
  );
}

function Dot({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border-2",
        className,
      )}
    >
      {children}
    </span>
  );
}
