import { useRef } from "react";
import { Form, redirect, useLoaderData, useSubmit } from "react-router";
import {
  Calendar,
  Globe,
  Info,
  Link2,
  Tag,
  Users,
} from "lucide-react";
import type { Route } from "./+types/projects.$id.public-view";
import { prisma } from "~/lib/db";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { isCore, isProjectMember } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { EditableSection } from "~/components/EditableSection";
import { ProjectImageBanner } from "../components/ProjectImageBanner";
import { ProjectViewSwitch } from "../components/ProjectViewSwitch";
import { loadPublicProjectView } from "../lib/public-project-view.server";
import type { ProjectShowcaseStatus } from "~/generated/prisma/client";

export const meta: Route.MetaFunction = ({ data }) => {
  const n = (data as { project?: { name: string } } | undefined)?.project?.name;
  return [{ title: n ? `${n} · Public view · DALI OS` : "Public view · DALI OS" }];
};

export const handle = {
  breadcrumb: (data: unknown) => {
    const d = data as { project?: { name: string } } | undefined;
    return d?.project ? d.project.name : null;
  },
  headerAction: (data: unknown) => {
    const d = data as { project?: { id: string } } | undefined;
    if (!d?.project) return null;
    return <ProjectViewSwitch projectId={d.project.id} current="public" />;
  },
};

const STATUSES: ProjectShowcaseStatus[] = [
  "NotStarted",
  "InProgress",
  "NeedsReview",
  "Published",
  "Archive",
];

const STATUS_LABELS: Record<ProjectShowcaseStatus, string> = {
  NotStarted: "Not started",
  InProgress: "In progress",
  NeedsReview: "Needs review",
  Published: "Published — live on dali.website",
  Archive: "Archived",
};

// Content edits follow the same rule as every other project surface — Core or
// anyone staffed on the project. Flipping `status` is separate: Published
// pushes the project onto the public marketing site, which is a lab-level
// call, so that one intent is Core-only.
const CONTENT_INTENTS = [
  "showcase-details",
  "showcase-tags",
  "showcase-links",
  "showcase-image",
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const data = await loadPublicProjectView(params.id!);
  if (!data) return redirect("/projects");

  const core = await isCore(auth.user.sub);
  const canEdit = core || (await isProjectMember(auth.user.sub, params.id!));
  return { ...data, canEdit, canPublish: core };
}

// Splits a comma-separated tag field into a clean list. Notion exported these
// as ", "-joined strings and the inputs keep that shape, since a chip editor
// would be a heavier control than four rarely-touched facet lists warrant.
function tagList(form: FormData, name: string): string[] {
  return ((form.get(name) as string | null) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function optional(form: FormData, name: string): string | null {
  const value = (form.get(name) as string | null)?.trim() ?? "";
  return value === "" ? null : value;
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const projectId = params.id!;
  const core = await isCore(auth.user.sub);
  if (!core && !(await isProjectMember(auth.user.sub, projectId))) {
    return { error: "You don't have permission to edit this project." };
  }

  const form = await request.formData();
  const intent = (form.get("intent") as string | null) ?? "";

  if (intent === "showcase-status" && !core) {
    return { error: "Only Core or Admin can change what is published publicly." };
  }
  if (intent !== "showcase-status" && !CONTENT_INTENTS.includes(intent)) {
    return { error: "Unknown action." };
  }

  let data: Record<string, unknown>;
  let newStatus: ProjectShowcaseStatus | null = null;
  if (intent === "showcase-details") {
    const yearRaw = (form.get("year") as string | null)?.trim() ?? "";
    const year = yearRaw === "" ? null : Number.parseInt(yearRaw, 10);
    if (year !== null && (Number.isNaN(year) || year < 1990 || year > 2100)) {
      return { error: "Year must be a four-digit year." };
    }
    data = {
      displayName: optional(form, "displayName"),
      tagline: optional(form, "tagline"),
      year,
    };
  } else if (intent === "showcase-tags") {
    data = {
      partners: tagList(form, "partners"),
      products: tagList(form, "products"),
      sectors: tagList(form, "sectors"),
      techStack: tagList(form, "techStack"),
    };
  } else if (intent === "showcase-links") {
    data = {
      appUrl: optional(form, "appUrl"),
      websiteUrl: optional(form, "websiteUrl"),
      blogUrl: optional(form, "blogUrl"),
      pressUrl: optional(form, "pressUrl"),
    };
  } else if (intent === "showcase-image") {
    data = { heroImageUrl: optional(form, "heroImageUrl") };
  } else {
    const status = (form.get("status") as string | null) ?? "";
    if (!STATUSES.includes(status as ProjectShowcaseStatus)) {
      return { error: "Invalid status." };
    }
    newStatus = status as ProjectShowcaseStatus;
    data = { status: newStatus };
  }

  // Upsert, so the row is created lazily on first save rather than on every
  // page view of a project nobody intends to showcase.
  await prisma.projectShowcase.upsert({
    where: { projectId },
    create: { projectId, updatedById: auth.user.sub, ...data },
    update: { updatedById: auth.user.sub, ...data },
  });

  // Only the publish flip is audited — it's the one that changes what the
  // outside world can see. `projectId` is repeated in the metadata (not just
  // targetId) so the project page's Recent activity card can attribute it
  // with the same filter it uses for every other action.
  if (newStatus) {
    await logAuditEvent({
      action: "project.showcase-status",
      userId: auth.user.sub,
      targetId: projectId,
      metadata: { projectId, status: newStatus },
      request,
    });
  }

  return redirect(`/projects/${projectId}/public-view`);
}

const INPUT =
  "px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30";

function Field({
  label,
  name,
  value,
  editing,
  placeholder,
  type = "text",
}: {
  label: string;
  name: string;
  value: string;
  editing: boolean;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {editing ? (
        <input
          name={name}
          type={type}
          defaultValue={value}
          placeholder={placeholder}
          className={INPUT}
        />
      ) : (
        <span className="px-2 py-1.5 text-sm text-foreground break-all">
          {value || "—"}
        </span>
      )}
    </label>
  );
}

export default function ProjectPublicView() {
  const data = useLoaderData<typeof loader>();
  const { project, showcase, heroPreviewUrl, teamMembers, pages, canEdit, canPublish } = data;
  const submit = useSubmit();

  const detailsRef = useRef<HTMLFormElement | null>(null);
  const tagsRef = useRef<HTMLFormElement | null>(null);
  const linksRef = useRef<HTMLFormElement | null>(null);

  const s = showcase;
  const cardName = s?.displayName || project.name;
  const allTags = [
    ...(s?.products ?? []),
    ...(s?.sectors ?? []),
    ...(s?.techStack ?? []),
  ];
  const links = [
    ["Website", s?.websiteUrl],
    ["App", s?.appUrl],
    ["Student Blog", s?.blogUrl],
    ["Press", s?.pressUrl],
  ].filter(([, url]) => url) as [string, string][];

  const publicPage = pages.find((p) => p.publicVisible);

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-5xl mx-auto w-full">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-bold text-foreground inline-flex items-center gap-2">
          <Globe className="w-5 h-5 text-accent-coral" />
          Public view
        </h1>
        <p className="text-sm text-muted-foreground">
          What visitors see for this project on dali.website. Nothing here is
          derived from the internal hub — the public framing is written
          separately, and only a status of “Published” puts it on the site.
        </p>
      </header>

      {/* Preview: the showcase card as dali.website draws it, so curating is
          WYSIWYG rather than fill-in-the-fields-and-hope. */}
      <section className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Preview
          </span>
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              s?.status === "Published"
                ? "bg-accent-green/15 text-accent-green"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {STATUS_LABELS[s?.status ?? "NotStarted"]}
          </span>
        </div>
        <div className="p-4">
          <div className="max-w-sm border border-border rounded-lg overflow-hidden bg-background">
            {heroPreviewUrl ? (
              <img src={heroPreviewUrl} alt="" className="w-full h-40 object-cover" />
            ) : (
              <div className="w-full h-40 bg-gradient-to-br from-accent-coral/25 to-accent-green/20" />
            )}
            <div className="p-4 flex flex-col gap-2">
              <h3 className="font-semibold text-lg text-foreground leading-tight">
                {cardName}
              </h3>
              <p className="text-sm text-muted-foreground">
                {s?.tagline || "No tagline yet"}
              </p>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" />
                  {s?.year ?? "—"}
                </span>
                {s?.sectors?.[0] && <span>{s.sectors[0]}</span>}
              </div>
              {allTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {allTags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 text-xs rounded border border-border text-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                  {allTags.length > 3 && (
                    <span className="px-2 py-0.5 text-xs rounded border border-border text-muted-foreground">
                      +{allTags.length - 3} more
                    </span>
                  )}
                </div>
              )}
              {teamMembers.length > 0 && (
                <div className="border-t border-border pt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="w-4 h-4" />
                  <span className="line-clamp-1">
                    {teamMembers.slice(0, 2).join(", ")}
                    {teamMembers.length > 2 && ` +${teamMembers.length - 2} more`}
                  </span>
                </div>
              )}
              {links.length > 0 && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {links.map(([label, url]) => (
                    <a
                      key={label}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent-coral hover:underline"
                    >
                      {label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {canPublish && (
        <EditableSection
          title="Publication status"
          icon={<Globe className="w-4 h-4" />}
          description="Only “Published” appears on dali.website. Core/Admin only."
          canEdit
          onSave={() => {}}
        >
          {() => (
            <Form method="post" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="intent" value="showcase-status" />
              <select
                name="status"
                defaultValue={s?.status ?? "NotStarted"}
                className={INPUT}
              >
                {STATUSES.map((v) => (
                  <option key={v} value={v}>
                    {STATUS_LABELS[v]}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
              >
                Update status
              </button>
            </Form>
          )}
        </EditableSection>
      )}

      <EditableSection
        title="Showcase details"
        icon={<Info className="w-4 h-4" />}
        description="The name and one-line statement the public site leads with."
        canEdit={canEdit}
        onSave={() => {
          if (detailsRef.current) submit(detailsRef.current);
        }}
      >
        {({ editing }) => (
          <Form method="post" ref={detailsRef} className="flex flex-col gap-3">
            <input type="hidden" name="intent" value="showcase-details" />
            <Field
              label={`Public name (internal: ${project.name})`}
              name="displayName"
              value={s?.displayName ?? ""}
              editing={editing}
              placeholder={project.name}
            />
            <Field
              label="Statement"
              name="tagline"
              value={s?.tagline ?? ""}
              editing={editing}
              placeholder="Assessing personal risk during COVID"
            />
            <Field
              label="Year"
              name="year"
              type="number"
              value={s?.year ? String(s.year) : ""}
              editing={editing}
              placeholder="2026"
            />
          </Form>
        )}
      </EditableSection>

      <EditableSection
        title="Tags"
        icon={<Tag className="w-4 h-4" />}
        description="Comma-separated. These drive the filters and tag pills on the projects page."
        canEdit={canEdit}
        onSave={() => {
          if (tagsRef.current) submit(tagsRef.current);
        }}
      >
        {({ editing }) => (
          <Form method="post" ref={tagsRef} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input type="hidden" name="intent" value="showcase-tags" />
            <Field
              label="Product"
              name="products"
              value={(s?.products ?? []).join(", ")}
              editing={editing}
              placeholder="Mobile, Web"
            />
            <Field
              label="Sector"
              name="sectors"
              value={(s?.sectors ?? []).join(", ")}
              editing={editing}
              placeholder="Health, Education"
            />
            <Field
              label="Tech stack"
              name="techStack"
              value={(s?.techStack ?? []).join(", ")}
              editing={editing}
              placeholder="React Native, Firebase"
            />
            <Field
              label="Partner"
              name="partners"
              value={(s?.partners ?? []).join(", ")}
              editing={editing}
              placeholder="Startup, Student Founder"
            />
          </Form>
        )}
      </EditableSection>

      <EditableSection
        title="Links"
        icon={<Link2 className="w-4 h-4" />}
        description="Shown as buttons on the public project card."
        canEdit={canEdit}
        onSave={() => {
          if (linksRef.current) submit(linksRef.current);
        }}
      >
        {({ editing }) => (
          <Form method="post" ref={linksRef} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input type="hidden" name="intent" value="showcase-links" />
            <Field label="Website" name="websiteUrl" value={s?.websiteUrl ?? ""} editing={editing} />
            <Field label="App" name="appUrl" value={s?.appUrl ?? ""} editing={editing} />
            <Field label="Student blog" name="blogUrl" value={s?.blogUrl ?? ""} editing={editing} />
            <Field label="Press" name="pressUrl" value={s?.pressUrl ?? ""} editing={editing} />
          </Form>
        )}
      </EditableSection>

      <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
        <div>
          <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
            <Globe className="w-4 h-4" />
            Hero image
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            The showcase card image. Separate from the internal hub banner —
            leave it unset to fall back to the project image.
          </p>
        </div>
        <ProjectImageBanner
          projectId={project.id}
          projectName={cardName}
          initialPreviewUrl={heroPreviewUrl}
          canEdit={canEdit}
          intent="showcase-image"
          fieldName="heroImageUrl"
          removeTitle="Remove the public hero image?"
          removeDescription="The project's internal banner will be used instead."
        />
      </section>

      <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-2">
        <h2 className="font-heading font-semibold text-foreground">Public write-up</h2>
        <p className="text-xs text-muted-foreground">
          The document rendered in the project's detail modal on dali.website.
          Mark one from the project's Documents list — the “Public” toggle sits
          beside the “Partner” one.
        </p>
        <p className="text-sm text-foreground">
          {publicPage ? (
            <>
              {publicPage.iconEmoji && <span className="mr-1.5">{publicPage.iconEmoji}</span>}
              {publicPage.title}
            </>
          ) : (
            <span className="text-muted-foreground">
              No page marked public — the detail modal will show the card fields only.
            </span>
          )}
        </p>
      </section>
    </div>
  );
}
