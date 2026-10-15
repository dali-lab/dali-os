import type { PillTone } from "~/hiring/components/cycle-setup/SetupCard";

// Per-domain hiring status as the applicant reads it on /portal and
// /portal/applications: a short label and a dot tone.
export const HIRING_STATUS: Record<string, { label: string; dot: PillTone }> = {
  ApplicationOpen: { label: "Not submitted", dot: "neutral" },
  Pending: { label: "Under review", dot: "warning" },
  InvitedToInterview: { label: "Interview invite", dot: "accent" },
  InterviewScheduled: { label: "Interview scheduled", dot: "accent" },
  PostInterviewPending: { label: "Decision pending", dot: "accent" },
  Accepted: { label: "Accepted", dot: "success" },
  AcceptedElsewhere: { label: "Placed elsewhere", dot: "neutral" },
  Waitlisted: { label: "Waitlisted", dot: "warning" },
  Rejected: { label: "Not accepted", dot: "danger" },
  Withdrawn: { label: "Withdrawn", dot: "neutral" },
};

const DECIDED = new Set(["Accepted", "AcceptedElsewhere", "Waitlisted", "Rejected", "Withdrawn"]);

export type PortalCycleCardInput = {
  open: boolean;
  closesOn: string | null;
  applicationStatus: string | null;
  domains: { name: string; status: string }[];
  applyHref: string;
  trackHref: string;
};

export type PortalCycleCard = {
  meta: string;
  action: { label: string; href: string } | null;
};

// The home card's one meta line and one button for a cycle. After submitting,
// the line follows the applicant's furthest domain status rather than
// staying at "Submitted", and the button names the next thing to do.
export function portalCycleCard(cycle: PortalCycleCardInput): PortalCycleCard {
  const due = cycle.closesOn ? `Due ${cycle.closesOn}` : null;
  const statuses = cycle.domains.map((d) => d.status);

  if (cycle.applicationStatus === "Draft") {
    return {
      meta: due ? `Draft · ${due}` : "Draft",
      action: { label: "Finish", href: cycle.open ? cycle.applyHref : cycle.trackHref },
    };
  }
  if (cycle.applicationStatus === "Withdrawn") {
    return { meta: "Withdrawn", action: { label: "View", href: cycle.trackHref } };
  }
  if (cycle.applicationStatus === "Submitted") {
    const labels = cycle.domains.map((d) => HIRING_STATUS[d.status]?.label ?? d.status);
    const meta =
      labels.length === 0
        ? "Submitted"
        : new Set(labels).size === 1
          ? labels[0]
          : cycle.domains.map((d, i) => `${d.name}: ${labels[i]}`).join(" · ");
    const label = statuses.includes("InvitedToInterview")
      ? "Book interview"
      : statuses.includes("InterviewScheduled")
        ? "View interview"
        : statuses.length > 0 && statuses.every((s) => DECIDED.has(s))
          ? "View decision"
          : "Track";
    return { meta, action: { label, href: cycle.trackHref } };
  }
  if (cycle.applicationStatus) {
    return { meta: cycle.applicationStatus, action: { label: "Track", href: cycle.trackHref } };
  }
  return {
    meta: cycle.open ? (due ?? "Open") : "Under review",
    action: cycle.open ? { label: "Apply", href: cycle.applyHref } : null,
  };
}
