import { Link } from "react-router";
import { OfferingApplyForm } from "~/education/components/OfferingApplyForm";
import { MyStatusChip, TypeBadge } from "~/education/components/OfferingCard";
import { buttonClasses } from "~/components/ui/Button";
import type { OfferingSurface } from "~/education/lib/offering-surface";

type ApplyViewProps = {
  surface: OfferingSurface;
  offering: { id: string; title: string; type: Parameters<typeof TypeBadge>[0]["type"]; requiresReview: boolean };
  open: boolean;
  myStatus: Parameters<typeof MyStatusChip>[0]["status"];
  questions: Parameters<typeof OfferingApplyForm>[0]["questions"];
  description: Parameters<typeof OfferingApplyForm>[0]["description"];
  defaultAnswers?: Parameters<typeof OfferingApplyForm>[0]["defaultAnswers"];
  versionUpdatedAt?: Parameters<typeof OfferingApplyForm>[0]["versionUpdatedAt"];
};

const FRAME = {
  member: {
    wrapper: "flex flex-col gap-4 max-w-2xl",
    h1: "mt-1 font-heading text-2xl font-bold text-foreground",
    card: "bg-card border border-border rounded-lg",
  },
  portal: {
    wrapper: "max-w-2xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-4",
    h1: "mt-1 font-heading text-4xl font-medium text-foreground",
    card: "bg-os-card rounded-os-card",
  },
} as const;

export function ApplyView({
  surface,
  offering,
  open,
  myStatus,
  questions,
  description,
  defaultAnswers,
  versionUpdatedAt,
}: ApplyViewProps) {
  const frame = FRAME[surface.kind];
  return (
    <div className={frame.wrapper}>
      <header>
        <div className="flex items-center gap-2">
          <TypeBadge type={offering.type} />
          <MyStatusChip status={myStatus} />
        </div>
        <h1 className={frame.h1}>
          {offering.requiresReview ? "Apply to" : "RSVP for"} {offering.title}
        </h1>
      </header>

      {open ? (
        <div className={`${frame.card} p-5`}>
          <OfferingApplyForm
            questions={questions}
            description={description}
            defaultAnswers={defaultAnswers}
            versionUpdatedAt={versionUpdatedAt}
            submitLabel={
              myStatus === "Submitted"
                ? "Update application"
                : offering.requiresReview
                  ? "Submit application"
                  : "RSVP"
            }
          />
        </div>
      ) : (
        <div className={`${frame.card} p-8 text-center`}>
          <p className="font-heading font-semibold text-foreground">
            {myStatus ? "Your application is in" : "Registration isn't open"}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {myStatus
              ? "Check the offering page for your current status."
              : "Check back when the registration window opens."}
          </p>
          {surface.kind === "portal" && (
            <Link
              to={`${surface.base}/${offering.id}`}
              className={buttonClasses("secondary", "sm") + " mt-4 inline-flex"}
            >
              Back to offering
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
