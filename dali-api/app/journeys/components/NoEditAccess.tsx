import { Link } from "react-router";
import { Lock } from "lucide-react";
import { Avatar } from "~/components/ui/Avatar";
import { buttonClasses } from "~/components/ui/Button";
import type { JourneyCollaborator } from "~/journeys/lib/journeys.server";

export function NoEditAccess({
  journeyName,
  owners,
  backHref,
  viewHref,
}: {
  journeyName: string;
  owners: JourneyCollaborator[];
  backHref: string;
  viewHref?: string;
}) {
  return (
    <div className="max-w-md">
      <Lock className="h-8 w-8 text-os-muted" aria-hidden />
      <h1 className="mt-4 font-heading text-2xl font-semibold">You can't edit this journey</h1>
      <p className="mt-2 leading-7 text-os-grey">
        Only its owners and the people they add can edit <span className="text-foreground">{journeyName}</span>.
        {owners.length > 0 && " Ask an owner to add you:"}
      </p>
      {owners.length > 0 && (
        <ul className="mt-4 divide-y divide-os-container">
          {owners.map((o) => (
            <li key={o.id} className="flex items-center gap-3 py-3">
              <Avatar photoUrl={o.photoUrl} name={o.name} size="sm" />
              <span className="min-w-0">
                <span className="block truncate text-sm text-foreground">{o.name}</span>
                {o.email && (
                  <a href={`mailto:${o.email}`} className="block truncate text-xs text-os-accent hover:underline">
                    {o.email}
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-8 flex flex-wrap gap-3">
        {viewHref && (
          <Link to={viewHref} className={buttonClasses("primary", "md")}>
            Open journey
          </Link>
        )}
        <Link to={backHref} className={buttonClasses(viewHref ? "ghost" : "secondary", "md")}>
          Back to journeys
        </Link>
      </div>
    </div>
  );
}
