import { Link, useLoaderData } from "react-router";
import { Building2, ExternalLink } from "lucide-react";
import type { Route } from "./+types/projects.$id.showcase";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { getShowcaseView } from "~/projects/lib/showcase-view.server";
import { ProjectViewSwitch } from "~/projects/components/ProjectViewSwitch";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.showcase.name ?? "Project"} · DALI OS` },
];

export const handle = {
  breadcrumb: (match: { data?: { showcase: { name: string } } }) =>
    match.data?.showcase.name ?? "Project",
  headerAction: (data: unknown) => {
    const d = data as { showcase?: { id: string }; canSwitchViews?: boolean } | undefined;
    if (!d?.showcase || !d.canSwitchViews) return null;
    return (
      <ProjectViewSwitch projectId={d.showcase.id} current="showcase" showcasePublished />
    );
  },
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = await redirectNonMemberToPortal(auth, request);
  if (portalRedirect) return portalRedirect;

  const showcase = await getShowcaseView(params.id);
  if (!showcase) throw new Response("Not found", { status: 404 });
  // Alumni are routed here *from* the internal views, so offering links back
  // into them would just bounce; members get the full switch.
  const roles = await getUserRoles(auth.user.sub, request);
  return { showcase, canSwitchViews: !roles.isAlumni };
}

export default function ProjectShowcase() {
  const { showcase, canSwitchViews } = useLoaderData<typeof loader>();
  const tags = [...showcase.products, ...showcase.sectors, ...showcase.techStack];

  return (
    <div className="flex max-w-5xl flex-col gap-10">
      {showcase.coverUrl && (
        <img
          src={showcase.coverUrl}
          alt=""
          className="aspect-[21/9] w-full rounded-os-card object-cover"
        />
      )}

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="font-heading text-4xl font-medium text-foreground">{showcase.name}</h1>
          {canSwitchViews && (
            <Link to={`/projects/${showcase.id}`} className="os-edit-btn shrink-0">
              <Building2 className="h-4 w-4" />
              Internal view
            </Link>
          )}
        </div>
        {showcase.tagline && <p className="text-lg text-os-grey">{showcase.tagline}</p>}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-os-grey">
          {showcase.year && <span>{showcase.year}</span>}
          {showcase.partners.length > 0 && <span>{showcase.partners.join(", ")}</span>}
        </p>
        {showcase.links.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-2">
            {showcase.links.map((l) => (
              <a
                key={l.label}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-os-container px-3 text-sm font-semibold text-os-accent transition-colors hover:bg-os-hover"
              >
                {l.label}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            ))}
          </div>
        )}
      </header>

      {showcase.details.length > 0 && (
        <section className="grid gap-5 md:grid-cols-2" aria-label="About this project">
          {showcase.details.map((d) => (
            <div key={d.item} className="flex flex-col gap-2 rounded-os-card bg-os-card p-6">
              <h2 className="font-heading text-lg font-semibold text-foreground">{d.item}</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-os-grey">
                {d.description}
              </p>
            </div>
          ))}
        </section>
      )}

      {showcase.media.length > 0 && (
        <section className="flex flex-col gap-4" aria-label="Gallery">
          <div className="grid gap-5 sm:grid-cols-2">
            {showcase.media.map((m) => (
              <figure key={m.url} className="flex flex-col gap-1.5">
                {m.type === "video" ? (
                  <video src={m.url} controls className="w-full rounded-os-card" />
                ) : (
                  <img src={m.url} alt={m.caption ?? ""} className="w-full rounded-os-card object-cover" />
                )}
                {m.caption && <figcaption className="text-xs text-os-grey">{m.caption}</figcaption>}
              </figure>
            ))}
          </div>
        </section>
      )}

      {(showcase.teamMembers.length > 0 || tags.length > 0) && (
        <section className="flex flex-col gap-4 rounded-os-card bg-os-well p-6">
          {showcase.teamMembers.length > 0 && (
            <div className="flex flex-col gap-1">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-os-grey">Team</h2>
              <p className="text-sm text-foreground">{showcase.teamMembers.join(", ")}</p>
            </div>
          )}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-os-container px-3 py-1 text-xs font-semibold text-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
