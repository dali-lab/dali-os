import { Link } from "react-router";
import { CourseHub } from "~/education/components/CourseHub";
import { buttonClasses } from "~/components/ui/Button";
import type { OfferingSurface } from "~/education/lib/offering-surface";

type OfferingHubViewProps = {
  surface: OfferingSurface;
  hub: Parameters<typeof CourseHub>[0]["data"] & { isManager?: boolean };
  collabToken: Parameters<typeof CourseHub>[0]["collabToken"];
  previewAsStudent: boolean;
};

export function OfferingHubView({ surface, hub, collabToken, previewAsStudent }: OfferingHubViewProps) {
  const basePath = `${surface.base}/${hub.offering.id}`;

  if (surface.kind === "portal") {
    return (
      <div className="w-full px-4 sm:px-6 py-8 flex flex-col gap-4">
        <header>
          <p className="text-xs text-muted-foreground">
            <Link to={basePath} className="hover:underline">
              ← Offering details
            </Link>
          </p>
          <h1 className="mt-1 font-heading text-4xl font-medium text-foreground">{hub.offering.title}</h1>
        </header>
        <CourseHub data={hub} basePath={basePath} collabToken={collabToken} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">{hub.offering.title}</h1>
        </div>
        {hub.isManager && (
          <div className="flex items-center gap-2">
            <Link to={`${basePath}/hub?as=student`} className={buttonClasses("ghost", "sm")}>
              Student view
            </Link>
            <Link to={`${surface.base}/manage/${hub.offering.id}`} className={buttonClasses("secondary", "sm")}>
              Manage
            </Link>
          </div>
        )}
      </header>
      <CourseHub data={hub} basePath={basePath} collabToken={collabToken} />
      {previewAsStudent && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-os-accent/40 bg-card/95 px-4 py-2 shadow-[0_16px_40px_var(--color-os-shadow)] backdrop-blur">
            <span className="text-sm font-medium text-foreground">👁 Viewing as a student</span>
            <Link to={`${basePath}/hub`} className={buttonClasses("secondary", "sm")}>
              Exit
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
