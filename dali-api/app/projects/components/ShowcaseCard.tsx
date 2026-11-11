import { Link } from "react-router";
import type { ShowcaseCardData } from "~/projects/lib/showcase-view.server";

/* The dali.website project card as it appears inside DALI OS: the public
   showcase fields (display name, tagline, hero image, year, partners) rather
   than internal lifecycle state. Height-adaptive so a viewport-fit row can
   size it. */
export function ShowcaseCard({ showcase }: { showcase: ShowcaseCardData }) {
  return (
    <Link
      to={`/projects/${showcase.id}/showcase`}
      className="group flex h-full flex-col overflow-hidden rounded-os-card bg-os-card transition-[background-color,transform,box-shadow] duration-300 ease-[cubic-bezier(0.2,0.8,0.3,1)] hover:bg-os-card-hover hover:shadow-[0_12px_28px_-10px_var(--color-os-shadow)] hover:duration-200 motion-safe:hover:-translate-y-1"
    >
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {showcase.coverUrl ? (
          <img
            src={showcase.coverUrl}
            alt=""
            className="h-full min-h-24 w-full object-cover transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.04]"
          />
        ) : (
          <div
            className="flex h-full min-h-24 w-full items-center justify-center border-b border-border bg-gradient-to-br from-os-accent/30 via-os-accent/15 to-os-green/20"
            aria-hidden
          >
            <span className="font-heading text-3xl font-bold text-os-accent/70">
              {showcase.name.trim().charAt(0).toUpperCase() || "?"}
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5 p-4">
        <span className="truncate font-heading text-lg text-foreground">{showcase.name}</span>
        {showcase.tagline && (
          <span className="line-clamp-2 text-sm text-os-grey">{showcase.tagline}</span>
        )}
        <span className="flex min-w-0 items-center gap-2 text-xs text-os-grey">
          {showcase.year && <span className="shrink-0 font-semibold">{showcase.year}</span>}
          {showcase.partners.length > 0 && (
            <span className="truncate">{showcase.partners.join(", ")}</span>
          )}
        </span>
      </div>
    </Link>
  );
}
