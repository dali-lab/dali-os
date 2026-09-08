import { Link } from "react-router";
import { Avatar } from "~/components/ui/Avatar";
import { cn } from "~/lib/cn";
import { formatDateShort } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { MyStatusChip, registrationWindowLabel, type OfferingCardData } from "../OfferingCard";

type CatalogEntry = OfferingCardData & { myStatus?: string | null };

/**
 * Light card on the dark navy catalog band. Shows title, type badge, date range,
 * session count, instructor stack, seats context, and a CTA — Apply (accent-yellow
 * outline) or RSVP (teal) — or the user's status chip when they already have an
 * application.
 */
export function CatalogOfferingCard({
  offering,
  basePath,
}: {
  offering: CatalogEntry;
  basePath: string;
}) {
  const tz = useUserTimeZone();
  const seatsLeft = Math.max(0, offering.capacity - offering.approvedCount);
  const hasApp = offering.myStatus != null && offering.myStatus !== "";

  return (
    <div className="group relative">
      <Link
        to={`${basePath}/${offering.id}`}
        className="block rounded-2xl bg-white/10 border border-white/15 p-4 h-full transition-all group-hover:bg-white/15 group-hover:border-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal"
      >
        {/* Type badge */}
        <div className="flex items-center gap-2 mb-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
              offering.type === "Miniseries"
                ? "bg-accent-teal-light/20 text-accent-teal-light"
                : "bg-accent-coral-light/20 text-accent-coral-light",
            )}
          >
            {offering.type}
          </span>
        </div>

        {/* Title */}
        <h3 className="font-heading font-bold text-white text-sm leading-snug mb-1 group-hover:text-accent-yellow transition-colors">
          {offering.title}
        </h3>

        {/* Date + sessions */}
        <p className="text-xs text-white/60 mb-0.5">
          {offering.startsAt && offering.endsAt
            ? `${formatDateShort(offering.startsAt, tz)} – ${formatDateShort(offering.endsAt, tz)}`
            : "Dates TBD"}
          {" · "}
          {offering.sessionCount} session{offering.sessionCount === 1 ? "" : "s"}
        </p>

        {/* Registration window */}
        <p className="text-xs text-white/50 mb-3">
          {registrationWindowLabel(offering, tz)}
          {seatsLeft > 0
            ? ` · ${seatsLeft} seats left`
            : " · Full — waitlist open"}
        </p>

        {/* Instructor row */}
        {offering.instructors.length > 0 && (
          <div className="flex items-center gap-2 mb-4">
            <div className="flex -space-x-1.5">
              {offering.instructors.map((i) => (
                <Avatar
                  key={i.userId}
                  photoUrl={i.photoUrl}
                  name={i.name}
                  size="xs"
                  className="ring-2 ring-white/10"
                />
              ))}
            </div>
            <p className="text-xs text-white/60 truncate">
              {offering.instructors.map((i) => i.name).join(", ")}
            </p>
          </div>
        )}

        {/* CTA or status chip */}
        <div className="mt-auto">
          {hasApp ? (
            <MyStatusChip status={offering.myStatus ?? null} />
          ) : offering.requiresReview ? (
            <span className="inline-flex items-center rounded-full border border-accent-yellow/70 px-3 py-1 text-xs font-semibold text-accent-yellow">
              Apply
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-accent-teal/20 border border-accent-teal/40 px-3 py-1 text-xs font-semibold text-accent-teal-light">
              RSVP
            </span>
          )}
        </div>
      </Link>
    </div>
  );
}
