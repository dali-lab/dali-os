import { Link } from "react-router";
import { ArrowUpRight, CheckCircle2, Clock, FlaskConical, ListChecks, Lock, PlayCircle, Presentation, X } from "lucide-react";
import type { ReactNode } from "react";
import { buttonClasses } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { cn } from "~/lib/cn";
import { getLabInfo, getModuleStatus, moduleTitle, richDocHas } from "~/journeys/lib/journey";
import type { Journey, JourneyModule } from "~/journeys/lib/types";
import { StatusChip } from "./StatusChip";

const itemClass = "flex items-center gap-3 rounded-os-item px-2 py-2.5 text-sm";

function OutlineItem({ href, icon, children }: { href: string | null; icon: ReactNode; children: ReactNode }) {
  if (!href) {
    return (
      <span className={cn(itemClass, "text-os-muted")}>
        {icon}
        <span className="flex-1">{children}</span>
      </span>
    );
  }
  return (
    <Link to={href} className={cn(itemClass, "group text-foreground/85 transition-colors hover:bg-os-hover hover:text-foreground")}>
      {icon}
      <span className="flex-1">{children}</span>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-os-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
    </Link>
  );
}

/** The selected module's details below the map: what's inside and what it builds on. */
export function ModulePreviewPanel({
  basePath,
  journey,
  module: mod,
  completed,
  openAll = false,
  onSelect,
}: {
  basePath: string;
  journey: Journey;
  module: JourneyModule;
  completed: ReadonlySet<string>;
  openAll?: boolean;
  onSelect: (moduleId: string | null) => void;
}) {
  const status = getModuleStatus(mod, completed, openAll);
  const lab = getLabInfo(mod);
  const locked = status === "locked";
  const moduleHref = `${basePath}/${mod.id}`;
  const at = (query: string) => (locked ? null : `${moduleHref}?${query}`);
  const prerequisites = mod.dependsOn
    .map((id) => journey.modules.find((m) => m.id === id))
    .filter((m): m is JourneyModule => Boolean(m));
  const missing = prerequisites.filter((p) => !completed.has(p.id));
  const iconClass = (accent: boolean) => cn("h-4 w-4 shrink-0", accent && !locked ? "text-os-accent" : "text-os-muted");

  const action = locked ? (
    <p className="text-sm text-os-grey">Finish {missing.map(moduleTitle).join(" and ")} to unlock.</p>
  ) : (
    <Link to={moduleHref} className={buttonClasses(status === "completed" ? "secondary" : "primary", "md")}>
      {status === "completed" ? "Review module" : "Start module"}
    </Link>
  );

  return (
    <aside
      aria-label={`${moduleTitle(mod)} details`}
      className="min-h-0 flex-1 overflow-y-auto rounded-os-card bg-os-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-6 pt-5">
        <div className="min-w-0 max-w-2xl">
          <StatusChip status={status} />
          <h2 className="mt-3 font-heading text-xl font-semibold">{moduleTitle(mod)}</h2>
          {mod.summary && <p className="mt-2 text-sm leading-6 text-os-grey">{mod.summary}</p>}
          <p className="mt-3 flex items-center gap-1.5 text-sm text-os-muted">
            <Clock className="h-4 w-4" aria-hidden />
            {mod.duration}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          <IconButton label="Close details" icon={X} onClick={() => onSelect(null)} />
        </div>
      </div>

      <div className="grid gap-x-10 gap-y-6 px-6 pb-6 pt-6 md:grid-cols-2">
        <section>
          <h3 className="text-xs font-medium text-os-muted">Inside this module</h3>
          <ol className="-mx-2 mt-2 space-y-0.5">
            {mod.pages.map((page, i) => (
              <li key={page.id}>
                <OutlineItem
                  href={at(`page=${i}`)}
                  icon={
                    richDocHas(page.content, "video") ? (
                      <PlayCircle className="h-4 w-4 shrink-0 text-os-muted" aria-label="Includes video" />
                    ) : (
                      <span className="grid h-4 w-4 shrink-0 place-items-center text-xs tabular-nums text-os-muted">{i + 1}</span>
                    )
                  }
                >
                  {page.title}
                </OutlineItem>
              </li>
            ))}
            {mod.slides && mod.slides.length > 0 && (
              <li>
                <OutlineItem href={at("view=slides")} icon={<Presentation className={iconClass(false)} aria-hidden />}>
                  Slides<span className="text-os-muted"> · {mod.slides.length}</span>
                </OutlineItem>
              </li>
            )}
            {lab && (
              <li>
                <OutlineItem href={at("view=lab")} icon={<FlaskConical className={iconClass(true)} aria-hidden />}>
                  Lab: {lab.title}
                  <span className="text-os-muted"> · {lab.meta}</span>
                </OutlineItem>
              </li>
            )}
            {mod.quiz && (
              <li>
                <OutlineItem href={at("view=quiz")} icon={<ListChecks className={iconClass(true)} aria-hidden />}>
                  Quiz: {mod.quiz.title}
                  <span className="text-os-muted"> · {mod.quiz.questions.length} questions</span>
                </OutlineItem>
              </li>
            )}
          </ol>
        </section>

        {prerequisites.length > 0 && (
          <section>
            <h3 className="text-xs font-medium text-os-muted">Builds on</h3>
            <ul className="-mx-2 mt-2 space-y-0.5">
              {prerequisites.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(p.id)}
                    className={cn(itemClass, "w-full text-left text-foreground/85 transition-colors hover:bg-os-hover")}
                  >
                    {completed.has(p.id) ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-os-green" aria-label="Completed" />
                    ) : (
                      <Lock className="h-4 w-4 shrink-0 text-os-muted" aria-label="Not completed" />
                    )}
                    {moduleTitle(p)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
