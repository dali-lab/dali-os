import { Link, Form } from "react-router";
import { buttonClasses } from "~/components/ui/Button";
import { useConfirmSubmit } from "~/components/ui/dialog";

// Status panel shown on the offering-detail URL when the viewer already has an
// application. Covers Submitted, Waitlisted, Approved, and Rejected states.

export function FunnelStatusPanel({
  myStatus,
  waitlistRank,
  offeringId,
  basePath,
  canReapply,
}: {
  myStatus: "Submitted" | "Waitlisted" | "Approved" | "Rejected";
  waitlistRank: number | null;
  offeringId: string;
  basePath: string;
  // Rejected users can re-apply when registration is still open.
  canReapply: boolean;
}) {
  const confirmSubmit = useConfirmSubmit();

  if (myStatus === "Approved") {
    return (
      <div className="rounded-lg border border-border bg-card p-5 flex items-center justify-between gap-4">
        <div>
          <p className="font-heading font-semibold text-foreground">You&apos;re in</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            You&apos;ve been approved. Open the course hub to see sessions, materials, and assignments.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to={`${basePath}/${offeringId}/hub`}
            className={buttonClasses("primary", "sm")}
          >
            Open course
          </Link>
          <WithdrawButton myStatus={myStatus} confirmSubmit={confirmSubmit} />
        </div>
      </div>
    );
  }

  if (myStatus === "Waitlisted") {
    return (
      <div className="rounded-lg border border-border bg-card p-5 flex items-center justify-between gap-4">
        <div>
          <p className="font-heading font-semibold text-foreground">
            Waitlisted{waitlistRank != null ? ` · #${waitlistRank} in line` : ""}
          </p>
          <p className="text-sm text-muted-foreground mt-0.5">
            If a seat opens before registration closes you&apos;ll be enrolled automatically and notified.
          </p>
        </div>
        <WithdrawButton myStatus={myStatus} confirmSubmit={confirmSubmit} />
      </div>
    );
  }

  if (myStatus === "Submitted") {
    return (
      <div className="rounded-lg border border-border bg-card p-5 flex items-center justify-between gap-4">
        <div>
          <p className="font-heading font-semibold text-foreground">Submitted · under review</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            Instructors will review applications and notify you of their decision.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to="?step=apply"
            className={buttonClasses("secondary", "sm")}
          >
            Edit application
          </Link>
          <WithdrawButton myStatus={myStatus} confirmSubmit={confirmSubmit} />
        </div>
      </div>
    );
  }

  // Rejected — if canReapply, the detail/form state renders instead (caller
  // responsibility); this panel shows a closed message when re-apply isn't open.
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="font-heading font-semibold text-foreground">Not accepted</p>
      <p className="text-sm text-muted-foreground mt-0.5">
        {canReapply
          ? "You can resubmit while registration is still open."
          : "Registration is closed."}
      </p>
    </div>
  );
}

function WithdrawButton({
  myStatus,
  confirmSubmit,
}: {
  myStatus: "Submitted" | "Waitlisted" | "Approved";
  confirmSubmit: ReturnType<typeof useConfirmSubmit>;
}) {
  return (
    <Form
      method="post"
      onSubmit={confirmSubmit({
        title: "Withdraw from this offering?",
        description:
          myStatus === "Approved"
            ? "Your seat opens up for the next person on the waitlist."
            : "This removes your application. You can re-apply while registration is open.",
        confirmLabel: "Withdraw",
        tone: "destructive",
      })}
    >
      <input type="hidden" name="intent" value="withdraw" />
      <button type="submit" className={buttonClasses("ghost", "sm")}>
        Withdraw
      </button>
    </Form>
  );
}
