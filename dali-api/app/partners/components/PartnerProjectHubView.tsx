import { Link } from "react-router";
import { termCodeLabel } from "~/lib/display";
import type { PartnerProjectViewData } from "~/partners/lib/partner-project-view.server";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// Renders the partner-facing read surface for a project. Shared by the real
// partner portal (partner.projects.$id.tsx) and the in-app preview any
// signed-in member can open from the project page
// (projects.$id.partner-view.tsx) — same content, different chrome around it
// via `backLink`, and pageHref for shared-document links. `backLink` is
// optional: the in-app preview instead swaps the project page's "Partner
// view" header button for an "Internal view" one (see that route's
// `handle.headerAction`), so it has no back link of its own here.
export function PartnerProjectHubView({
  data,
  backLink,
  pageHref,
}: {
  data: PartnerProjectViewData;
  backLink?: { to: string; label: string };
  pageHref: (pageId: string) => string;
}) {
  const {
    project,
    partnerSince,
    currentTermCode,
    team,
    sprints,
    nextSprint,
    recentlyDone,
    sharedPages,
  } = data;

  return (
    <div className="flex flex-col gap-8">
      <div>
        {backLink && (
          <Link to={backLink.to} className="text-xs text-muted-foreground hover:text-foreground">
            ← {backLink.label}
          </Link>
        )}
        <div
          className={`bg-card border border-border rounded-2xl overflow-hidden ${backLink ? "mt-2" : ""}`}
        >
          {project.imageUrl && (
            <img src={project.imageUrl} alt="" className="w-full h-40 object-cover" />
          )}
          <div className="p-5">
            <h1 className="font-heading text-3xl font-bold text-dark-blue">
              {project.name}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {[
                project.terms.length > 0
                  ? `Terms: ${project.terms.map(termCodeLabel).join(", ")}`
                  : null,
                partnerSince ? `Partner since ${fmtDate(partnerSince)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {project.description && (
              <p className="text-sm text-foreground mt-3 whitespace-pre-wrap">
                {project.description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* What's going on right now */}
      <section>
        <h2 className="font-heading text-lg font-semibold text-dark-blue mb-3">
          Current work
        </h2>
        {sprints.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-6 text-sm text-muted-foreground">
            No sprint in flight right now.
            {nextSprint && (
              <>
                {" "}Next up: <strong>{nextSprint.name}</strong> ({fmtDate(nextSprint.startsAt)} – {fmtDate(nextSprint.endsAt)}).
              </>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {sprints.map((s) => {
              const total = s.done + s.open;
              const pct = total > 0 ? Math.round((s.done / total) * 100) : 0;
              return (
                <div key={s.id} className="bg-card border border-border rounded-2xl p-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-heading font-semibold text-dark-blue">
                      {s.name}
                    </span>
                    <span
                      className={`text-xs rounded-full px-2 py-0.5 ${
                        s.status === "Active"
                          ? "bg-accent-teal/15 text-accent-teal"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {s.status === "Active" ? "In progress" : "Wrapped up"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {fmtDate(s.startsAt)} – {fmtDate(s.endsAt)}
                  </p>
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <span>
                        {s.done} of {total} tasks done
                      </span>
                      <span>{pct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-accent-teal rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            {nextSprint && (
              <div className="bg-card border border-dashed border-border rounded-2xl p-5 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Next up:</span>{" "}
                {nextSprint.name} ({fmtDate(nextSprint.startsAt)} – {fmtDate(nextSprint.endsAt)})
              </div>
            )}
          </div>
        )}
      </section>

      {recentlyDone.length > 0 && (
        <section>
          <h2 className="font-heading text-lg font-semibold text-dark-blue mb-3">
            Recently completed
          </h2>
          <ul className="bg-card border border-border rounded-2xl divide-y divide-border">
            {recentlyDone.map((t) => (
              <li key={t.id} className="px-4 py-3 flex items-center gap-3 text-sm">
                <span className="text-accent-teal">✓</span>
                <span className="flex-1 min-w-0 truncate text-foreground">{t.title}</span>
                {t.domain && (
                  <span className="text-xs rounded-full bg-muted text-muted-foreground px-2 py-0.5 flex-shrink-0">
                    {t.domain}
                  </span>
                )}
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {fmtDate(t.doneAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Shared docs */}
      <section>
        <h2 className="font-heading text-lg font-semibold text-dark-blue mb-3">
          Shared documents
        </h2>
        {sharedPages.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-6 text-sm text-muted-foreground">
            The team hasn't shared any documents yet.
          </div>
        ) : (
          <ul className="bg-card border border-border rounded-2xl divide-y divide-border">
            {sharedPages.map((p) => (
              <li key={p.id}>
                <Link
                  to={pageHref(p.id)}
                  className="px-4 py-3 flex items-center gap-3 text-sm hover:bg-muted/20 transition"
                >
                  <span>{p.iconEmoji ?? "📄"}</span>
                  <span className="flex-1 min-w-0 truncate font-medium text-foreground">
                    {p.title}
                  </span>
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    Updated {fmtDate(p.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Team */}
      {team.length > 0 && (
        <section>
          <h2 className="font-heading text-lg font-semibold text-dark-blue mb-3">
            Your DALI team{currentTermCode ? ` · ${termCodeLabel(currentTermCode)}` : ""}
          </h2>
          <div className="bg-card border border-border rounded-2xl p-5 flex flex-wrap gap-3">
            {team.map((m) => (
              <div
                key={m.name}
                className="rounded-xl bg-brand-tint px-3 py-2 text-sm"
              >
                <span className="font-medium text-dark-blue">{m.name}</span>
                <span className="text-xs text-muted-foreground block">
                  {m.domains.join(", ")}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
