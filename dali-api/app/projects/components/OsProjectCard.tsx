import { Link } from "react-router";
import { Globe } from "lucide-react";
import { ProjectCoverImage } from "~/projects/components/ProjectCoverImage";
import { ProjectIcon } from "~/components/ProjectIcon";
import type { ShowcaseStatusValue } from "~/projects/lib/showcase-filter";

type ProjectStatus = "Active" | "Paused" | "Archived";

export type OsProjectCardProject = {
  id: string;
  name: string;
  iconEmoji: string | null;
  status: ProjectStatus;
  firstTermCode: string | null;
  imageUrl: string | null;
  partners: { name: string; logoUrl: string | null }[];
  showcaseStatus: ShowcaseStatusValue | null;
};

// One plate for every chip a project wears — its status and its publication
// state alike. They sit side by side in the corner of a card's cover, so a
// difference between them is visible as a difference: they used to disagree
// about padding, corner radius and weight all at once.
const PROJECT_CHIP =
  "inline-flex items-center gap-1 rounded-full border bg-os-bg/85 px-3 py-[5px] text-xs font-semibold";

// The design's status tag: a translucent plate that reads on any photo, tinted
// per status.
export function OsStatusTag({ status }: { status: ProjectStatus }) {
  const palette: Record<ProjectStatus, string> = {
    Active: "text-os-green border-os-green/35",
    Archived: "text-os-grey border-os-grey/35",
    Paused: "text-os-amber border-os-amber/35",
  };
  return <span className={`${PROJECT_CHIP} ${palette[status]}`}>{status}</span>;
}

// Marks a project as live on dali.website. Only Published gets a badge: it's
// the state with consequences outside the lab, and badging all five would put a
// second pill on every row in a list that is mostly not published. The filter
// covers the other states.
export function PublicPill({ status }: { status: ShowcaseStatusValue | null }) {
  if (status !== "Published") return null;
  return (
    <span
      title="Published on dali.website"
      className={`${PROJECT_CHIP} border-os-accent/35 text-os-accent`}
    >
      <Globe className="h-3 w-3" />
      Published
    </span>
  );
}

/* The design's project card: cover-led, with the status riding the image and
   the term and partner reduced to one line each. Same fields as ProjectCard —
   status, publication state, term, partners — so nothing the list view can tell
   you is missing here; only the emphasis changes. */
export function OsProjectCard({ project }: { project: OsProjectCardProject }) {
  const [first, ...restPartners] = project.partners;
  return (
    // Hover: lift and shadow move together so the card reads as rising rather
    // than sliding, and the cover scales on a slower curve than the frame so
    // the two don't land on the same beat. Hover-in is quicker (200ms) than
    // the settle back out (300ms), which is what keeps it from feeling stepped.
    <Link
      to={`/projects/${project.id}`}
      className="group flex flex-col overflow-hidden rounded-os-card bg-os-card transition-[background-color,transform,box-shadow] duration-300 ease-[cubic-bezier(0.2,0.8,0.3,1)] hover:bg-os-card-hover hover:shadow-[0_12px_28px_-10px_var(--color-os-shadow)] hover:duration-200 motion-safe:hover:-translate-y-1"
    >
      <div className="relative overflow-hidden">
        <ProjectCoverImage
          name={project.name}
          imageUrl={project.imageUrl}
          className="h-[183px] w-full object-cover transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.04]"
          placeholderClassName="h-[183px] w-full transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.04]"
        />
        <div className="absolute right-3 top-3 flex items-center gap-1.5">
          <PublicPill status={project.showcaseStatus} />
          <OsStatusTag status={project.status} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-[17px]">
        <span className="flex min-w-0 items-center gap-1.5 text-xl text-foreground">
          <ProjectIcon iconEmoji={project.iconEmoji} size="inherit" />
          <span className="truncate">{project.name}</span>
        </span>
        {project.firstTermCode && (
          <span className="flex items-center gap-2">
            <span className="rounded-full bg-os-container px-3 py-1 text-xs font-semibold text-foreground">
              {project.firstTermCode}
            </span>
            <span className="text-xs text-os-grey">Start term</span>
          </span>
        )}
        <span className="mt-auto flex min-w-0 items-center gap-2.5 text-sm text-os-grey">
          {first ? (
            <>
              {first.logoUrl ? (
                <img
                  src={first.logoUrl}
                  alt=""
                  className="h-5 w-5 flex-shrink-0 rounded-full object-contain"
                />
              ) : (
                <span className="h-5 w-5 flex-shrink-0 rounded-full bg-os-container" />
              )}
              <span className="truncate">{first.name}</span>
              {restPartners.length > 0 && (
                <span
                  className="flex-shrink-0 text-xs"
                  title={restPartners.map((p) => p.name).join(", ")}
                >
                  +{restPartners.length}
                </span>
              )}
            </>
          ) : (
            <span className="text-os-muted">No partners</span>
          )}
        </span>
      </div>
    </Link>
  );
}
