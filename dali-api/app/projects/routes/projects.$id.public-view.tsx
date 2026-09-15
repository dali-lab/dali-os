import { useRef, useState } from "react";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import { useDialog } from "~/components/ui/dialog";
import { Select } from "~/components/ui/floating";
import { Calendar, Globe, Plus, Users, X } from "lucide-react";
import type { Route } from "./+types/projects.$id.public-view";
import { prisma } from "~/lib/db";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isProjectMember } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { ProjectImageBanner } from "../components/ProjectImageBanner";
import { ProjectViewSwitch } from "../components/ProjectViewSwitch";
import { ProjectIcon } from "~/components/ProjectIcon";
import { ShowcaseDetailList } from "../components/ShowcaseDetailList";
import { ShowcaseMediaEditor } from "../components/ShowcaseMediaEditor";
import { DEFAULT_DETAILS } from "../lib/showcase-content";
import { loadPublicProjectView } from "../lib/public-project-view.server";
import type { ProjectShowcaseStatus } from "~/generated/prisma/client";

export const meta: Route.MetaFunction = ({ data }) => {
  const n = (data as { project?: { name: string } } | undefined)?.project?.name;
  return [{ title: n ? `${n} · Public view · DALI OS` : "Public view · DALI OS" }];
};

export const handle = {
  // breadcrumbTrail, not breadcrumb: a leaf label can only rename its OWN
  // segment, and this route's path has an id segment in the middle. Breadcrumbs
  // drops a mid-path id only when it looks opaque (a cuid); project ids here are
  // human-slugged, so `project-dali-os` survived the walk and titlecased itself
  // into a crumb — leaving "Projects › Project Dali Os › DALI OS", the project
  // nested inside a mangled copy of its own id. Declaring the whole trail skips
  // the segment walk entirely and gives the same two crumbs the project page
  // itself renders, icon included.
  breadcrumbTrail: (data: unknown) => {
    const p = (
      data as { project?: { id: string; name: string; iconEmoji: string | null } } | undefined
    )?.project;
    if (!p) return null;
    return [
      { label: "Projects", to: "/projects" },
      {
        label: p.name,
        to: `/projects/${p.id}`,
        icon: <ProjectIcon iconEmoji={p.iconEmoji} />,
      },
    ];
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
  "showcase-card",
  "showcase-image",
  "showcase-details",
  "showcase-media",
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const data = await loadPublicProjectView(params.id!);
  if (!data) return redirect("/projects");

  const core = await isCore(auth.user.sub);
  const canEdit = core || (await isProjectMember(auth.user.sub, params.id!));

  return {
    ...data,
    canEdit,
    canPublish: core,
  };
}

// Tag and link lists post as repeated fields of the same name, so the card can
// render one input per chip and the action rebuilds the list from what came
// back. Blank entries are dropped, which is also how a chip gets deleted.
function list(form: FormData, name: string): string[] {
  return form
    .getAll(name)
    .map((v) => String(v).trim())
    .filter(Boolean);
}

function optional(form: FormData, name: string): string | null {
  const value = (form.get(name) as string | null)?.trim() ?? "";
  return value === "" ? null : value;
}

// The detail sections post as parallel repeated fields, one detailItem and one
// detailDescription per row (ShowcaseDetailList renders them in lockstep), so
// zipping them by index reconstructs the pairs. Rows blank on both fields are
// dropped — that's also how a section gets deleted.
function detailPairs(form: FormData): { item: string; description: string }[] {
  const items = form.getAll("detailItem").map((v) => String(v).trim());
  const descs = form.getAll("detailDescription").map((v) => String(v).trim());
  return items
    .map((item, i) => ({ item, description: descs[i] ?? "" }))
    .filter((d) => d.item !== "" || d.description !== "");
}

// Same parallel-fields shape for the gallery: type/src/caption per row. src is
// an `uploads/` key or a URL; a blank src (nothing uploaded) drops the row.
function mediaItems(
  form: FormData,
): { type: "image" | "video"; src: string; caption?: string }[] {
  const types = form.getAll("mediaType").map((v) => String(v));
  const srcs = form.getAll("mediaSrc").map((v) => String(v).trim());
  const caps = form.getAll("mediaCaption").map((v) => String(v).trim());
  return srcs
    .map((src, i) => {
      const type = types[i] === "video" ? ("video" as const) : ("image" as const);
      const caption = caps[i] ?? "";
      return caption ? { type, src, caption } : { type, src };
    })
    .filter((m) => m.src !== "");
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
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

  if (intent === "showcase-card") {
    const yearRaw = (form.get("year") as string | null)?.trim() ?? "";
    const year = yearRaw === "" ? null : Number.parseInt(yearRaw, 10);
    if (year !== null && (Number.isNaN(year) || year < 1990 || year > 2100)) {
      return { error: "Year must be a four-digit year." };
    }
    data = {
      displayName: optional(form, "displayName"),
      tagline: optional(form, "tagline"),
      year,
      products: list(form, "products"),
      sectors: list(form, "sectors"),
      techStack: list(form, "techStack"),
      partners: list(form, "partners"),
      appUrl: optional(form, "appUrl"),
      websiteUrl: optional(form, "websiteUrl"),
      blogUrl: optional(form, "blogUrl"),
      pressUrl: optional(form, "pressUrl"),
    };
  } else if (intent === "showcase-image") {
    data = { heroImageUrl: optional(form, "heroImageUrl") };
  } else if (intent === "showcase-details") {
    data = { details: detailPairs(form) };
  } else if (intent === "showcase-media") {
    data = { media: mediaItems(form) };
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

// Inputs that carry no chrome until you interact with them, so the card reads
// as the rendered page rather than as a form. The dashed hover/focus ring is
// the only affordance — enough to find the fields, quiet enough that the
// preview still shows what a visitor will see.
const FIELD =
  "bg-transparent border border-transparent rounded px-1 -mx-1 hover:border-dashed hover:border-border focus:outline-none focus:border-solid focus:border-accent-coral/60 focus:bg-background transition-colors disabled:hover:border-transparent";

// A list of free-text chips (tags, links). Rendered as the pills the public
// card shows, each an input sized to its content, with an add button and a
// remove × per chip. Values post as repeated `name` fields.
function ChipList({
  name,
  label,
  hint,
  values,
  canEdit,
  placeholder,
  className,
}: {
  name: string;
  label: string;
  hint: string;
  values: string[];
  canEdit: boolean;
  placeholder: string;
  className: string;
}) {
  // Local state only tracks how many inputs exist; the values themselves stay
  // uncontrolled so typing never round-trips through React.
  const [rows, setRows] = useState<{ key: number; value: string }[]>(
    values.map((value, i) => ({ key: i, value })),
  );
  const [nextKey, setNextKey] = useState(values.length);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Named, because four rows of bare + buttons say nothing about what
          belongs in each. The hint is the vocabulary the public site filters
          on, so it doubles as a prompt for consistent values. */}
      <span className="w-16 shrink-0 text-muted-foreground" title={hint}>
        {label}
      </span>
      {rows.length === 0 && (
        <span className="text-muted-foreground/50 italic">{hint}</span>
      )}
      {rows.map((row, i) => (
        <span key={row.key} className={`inline-flex items-center gap-0.5 ${className}`}>
          <input
            name={name}
            defaultValue={row.value}
            placeholder={placeholder}
            disabled={!canEdit}
            size={Math.max(row.value.length || placeholder.length, 4)}
            className={`${FIELD} min-w-0`}
            onChange={(e) => {
              e.currentTarget.size = Math.max(e.currentTarget.value.length, 4);
            }}
          />
          {canEdit && (
            <button
              type="button"
              aria-label={`Remove ${row.value || placeholder}`}
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
              className="opacity-50 hover:opacity-100"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </span>
      ))}
      {canEdit && (
        <button
          type="button"
          onClick={() => {
            setRows([...rows, { key: nextKey, value: "" }]);
            setNextKey(nextKey + 1);
          }}
          aria-label={`Add ${label.toLowerCase()}`}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-solid"
        >
          <Plus className="w-3 h-3" />
          {label}
        </button>
      )}
    </div>
  );
}

export default function ProjectPublicView() {
  const data = useLoaderData<typeof loader>();
  const {
    project,
    showcase: s,
    heroPreviewUrl,
    teamMembers,
    canEdit,
    canPublish,
  } = data;
  const navigation = useNavigation();
  const saving = navigation.state !== "idle";
  const dialog = useDialog();

  // Seed the three default sections when nothing's been written yet — they're
  // prompts, so the editor opens with them and the public API filters them out
  // until they carry text.
  const detailsSeed =
    s?.details && s.details.length > 0 ? s.details : DEFAULT_DETAILS;
  const [pendingStatus, setPendingStatus] = useState<string>(s?.status ?? "NotStarted");
  const statusFormRef = useRef<HTMLFormElement>(null);
  const publishConfirmedRef = useRef(false);

  async function handleStatusSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (pendingStatus === "Published" && !publishConfirmedRef.current) {
      e.preventDefault();
      const confirmed = await dialog.confirm({
        title: "Publish to dali.website?",
        description:
          "This makes the project publicly visible on dali.website. Anyone on the internet will be able to see it.",
        confirmLabel: "Publish",
        tone: "destructive",
      });
      if (!confirmed) return;
      // Set flag so the re-submit bypasses this guard.
      publishConfirmedRef.current = true;
      statusFormRef.current?.requestSubmit();
      publishConfirmedRef.current = false;
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6 w-full">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-heading text-xl font-bold text-foreground inline-flex items-center gap-2">
            <Globe className="w-5 h-5 text-accent-coral" />
            Public view
          </h1>
          <p className="text-sm text-muted-foreground">
            This is the page as dali.website renders it. Edit it in place.
          </p>
        </div>
        {canPublish && (
          <Form method="post" ref={statusFormRef} className="flex items-center gap-2" onSubmit={(e) => void handleStatusSubmit(e)}>
            <input type="hidden" name="intent" value="showcase-status" />
            <Select
              name="status"
              defaultValue={s?.status ?? "NotStarted"}
              options={STATUSES.map((v) => ({ value: v, label: STATUS_LABELS[v] }))}
              buttonClassName="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
              onChange={(v) => setPendingStatus(v)}
            />
            <button
              type="submit"
              className="px-3 py-1.5 text-sm font-medium rounded-md border border-border hover:bg-muted/50 transition-colors"
            >
              Set
            </button>
          </Form>
        )}
      </header>

      {/* Card beside write-up on wide screens, stacked below. The card holds
          its natural width rather than stretching — a hero image pulled across
          a full desktop viewport stops looking like the card it's previewing —
          and the extra room goes to the write-up, which is the part that
          actually benefits from it. Sticky so it stays in view while writing. */}
      <div className="flex flex-col xl:flex-row gap-6 items-start">
        <Form
          method="post"
          className="flex flex-col w-full xl:w-[440px] xl:shrink-0 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto"
        >
          <input type="hidden" name="intent" value="showcase-card" />

          <div className="border border-border rounded-lg overflow-hidden bg-card">
            <ProjectImageBanner
              projectId={project.id}
              projectName={s?.displayName || project.name}
              initialPreviewUrl={heroPreviewUrl}
              canEdit={canEdit}
              intent="showcase-image"
              fieldName="heroImageUrl"
              removeTitle="Remove the public hero image?"
              removeDescription="The project's internal banner will be used instead."
            />

            <div className="p-5 flex flex-col gap-3">
              <input
                name="displayName"
                defaultValue={s?.displayName ?? ""}
                placeholder={project.name}
                disabled={!canEdit}
                aria-label="Public project name"
                className={`${FIELD} font-semibold text-xl text-foreground w-full`}
              />
              <input
                name="tagline"
                defaultValue={s?.tagline ?? ""}
                placeholder="One line on what this project does"
                disabled={!canEdit}
                aria-label="Statement"
                className={`${FIELD} text-muted-foreground w-full`}
              />

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="w-4 h-4 shrink-0" />
                <input
                  name="year"
                  type="number"
                  defaultValue={s?.year ?? ""}
                  placeholder="2026"
                  disabled={!canEdit}
                  aria-label="Year"
                  className={`${FIELD} w-20`}
                />
              </div>

              <div className="flex flex-col gap-2 text-xs">
                <ChipList
                  name="products"
                  label="Product"
                  hint="Mobile, Web, XR, Animation…"
                  values={s?.products ?? []}
                  canEdit={canEdit}
                  placeholder="Product"
                  className="px-2 py-0.5 rounded border border-border text-foreground"
                />
                <ChipList
                  name="sectors"
                  label="Sector"
                  hint="Health, Education, Sustainability…"
                  values={s?.sectors ?? []}
                  canEdit={canEdit}
                  placeholder="Sector"
                  className="px-2 py-0.5 rounded border border-border text-foreground"
                />
                <ChipList
                  name="techStack"
                  label="Tech"
                  hint="React Native, Firebase, Unity3D…"
                  values={s?.techStack ?? []}
                  canEdit={canEdit}
                  placeholder="Tech"
                  className="px-2 py-0.5 rounded border border-border text-foreground"
                />
                <ChipList
                  name="partners"
                  label="Partner"
                  hint="Startup, Student Founder, Nonprofit…"
                  values={s?.partners ?? []}
                  canEdit={canEdit}
                  placeholder="Partner"
                  className="px-2 py-0.5 rounded border border-border text-muted-foreground"
                />
              </div>

              {teamMembers.length > 0 && (
                <div className="border-t border-border pt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="w-4 h-4" />
                  <span className="line-clamp-1">
                    {teamMembers.slice(0, 2).join(", ")}
                    {teamMembers.length > 2 && ` +${teamMembers.length - 2} more`}
                  </span>
                  <span className="text-xs opacity-60">(from the project roster)</span>
                </div>
              )}

              <div className="border-t border-border pt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                {(
                  [
                    ["websiteUrl", "Website", s?.websiteUrl],
                    ["appUrl", "App", s?.appUrl],
                    ["blogUrl", "Student blog", s?.blogUrl],
                    ["pressUrl", "Press", s?.pressUrl],
                  ] as const
                ).map(([field, label, value]) => (
                  <label key={field} className="flex items-center gap-2">
                    <span className="text-xs shrink-0 w-28">
                      <span className="text-accent-coral">{label}</span>
                      <span className="text-muted-foreground/60"> (optional)</span>
                    </span>
                    <input
                      name={field}
                      defaultValue={value ?? ""}
                      placeholder="https://…"
                      disabled={!canEdit}
                      className={`${FIELD} flex-1 min-w-0 text-xs`}
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>

          {canEdit && (
            <div className="flex items-center gap-2 pt-3">
              <button
                type="submit"
                disabled={saving}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save card"}
              </button>
              <span className="text-xs text-muted-foreground">
                The hero image saves on upload; everything else saves here.
              </span>
            </div>
          )}
        </Form>

        {/* Write-up. Structured sections + a media gallery — dali.website
            renders the sections as headed cards and lays the media out below,
            so this stays data-only (no editor formatting leaks to the site). */}
        <section className="flex flex-col gap-6 flex-1 min-w-0 w-full">
          <div className="flex flex-col gap-2">
            <div>
              <h2 className="font-heading font-semibold text-foreground">
                Project details
              </h2>
              <p className="text-xs text-muted-foreground">
                Shown under the card on dali.website as headed cards — The
                Problem, Our Solution, The Impact, and any sections you add.
              </p>
            </div>
            <ShowcaseDetailList details={detailsSeed} canEdit={canEdit} />
          </div>

          <div className="flex flex-col gap-2">
            <div>
              <h2 className="font-heading font-semibold text-foreground">Media</h2>
              <p className="text-xs text-muted-foreground">
                Images and videos, shown as a gallery beneath the details.
              </p>
            </div>
            <ShowcaseMediaEditor
              projectId={project.id}
              media={s?.media ?? []}
              canEdit={canEdit}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
