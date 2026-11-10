import { APPLICATION_TZ } from "~/lib/timezone";
import { extractPlaceholders } from "~/lib/template-variables";

export type DecisionEmailDates = {
  /** The hire's start term code: the applicant's pick, else the cycle's term. */
  startTermCode: string | null;
  offerRespondBy: Date | null;
  waitlistRespondBy: Date | null;
};

type DecisionType = "Accepted" | "Waitlisted" | "Rejected" | "InvitedToInterview";

export function formatRespondBy(d: Date): string {
  return d.toLocaleDateString("en-US", {
    timeZone: APPLICATION_TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function respondByFor(type: DecisionType, dates: DecisionEmailDates): Date | null | undefined {
  if (type === "Accepted") return dates.offerRespondBy;
  if (type === "Waitlisted") return dates.waitlistRespondBy;
  return undefined;
}

/** The cycle-derived variables a decision email (and Accepted's next-steps block) can use. */
export function decisionEmailVars(
  type: DecisionType,
  dates: DecisionEmailDates,
): { startTerm?: string; respondBy?: string } {
  const vars: { startTerm?: string; respondBy?: string } = {};
  if (type === "Accepted" && dates.startTermCode) vars.startTerm = dates.startTermCode;
  const deadline = respondByFor(type, dates);
  if (deadline) vars.respondBy = formatRespondBy(deadline);
  return vars;
}

/**
 * Why this decision's email can't go out yet, or null. A template that quotes
 * {{respondBy}} or {{startTerm}} without the cycle having the value would send
 * a blank, and a respond-by date already past would ask for the impossible.
 */
export function decisionEmailVarsProblem(
  type: DecisionType,
  dates: DecisionEmailDates,
  templateTexts: string[],
  now: Date = new Date(),
): string | null {
  const used = new Set(templateTexts.flatMap((t) => extractPlaceholders(t)));

  if (type === "Accepted" && used.has("startTerm") && !dates.startTermCode) {
    return "The Accepted email uses {{startTerm}}, but this cycle has no term. Pick one on the Setup tab first.";
  }

  const deadline = respondByFor(type, dates);
  if (deadline === undefined || !used.has("respondBy")) return null;
  const which = type === "Accepted" ? "offer" : "waitlist";
  if (!deadline) {
    return `The ${type} email uses {{respondBy}}, but this cycle has no ${which} response date. Set it on the Setup tab first.`;
  }
  if (deadline.getTime() < now.getTime()) {
    return `The ${which} response date (${formatRespondBy(deadline)}) has passed. Update it on the Setup tab first.`;
  }
  return null;
}
