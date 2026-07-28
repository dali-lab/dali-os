import { useState } from "react";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import { Calendar, Globe, Plus, Users, X } from "lucide-react";
import type { Route } from "./+types/projects.$id.public-view";
import { prisma } from "~/lib/db";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { isCore, isProjectMember } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { ensurePublicWriteupPage } from "~/lib/pages";
import { parseSessionCookie } from "~/lib/cookies";
import { getPresenceUser } from "~/lib/presence-user";
import { fullName } from "~/lib/display";
import { CollaborativeEditor } from "~/components/CollaborativeEditor";
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
const CONTENT_INTENTS = ["showcase-card", "showcase-image", "showcase-writeup"];

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const data = await loadPublicProjectView(params.id!);
  if (!data) return redirect("/projects");

  const core = await isCore(auth.user.sub);
  const canEdit = core || (await isProjectMember(auth.user.sub, params.id!));

  // The write-up is a collab document, so it needs the same session token and
  // presence identity the standalone document route hands the editor.
  const presenceUser = await getPresenceUser(auth.user.sub);
  return {
    ...data,
    canEdit,
    canPublish: core,
    collabToken: parseSessionCookie(request),
    userName: presenceUser?.name ?? "Someone",
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

  // Starting the write-up doesn't touch the showcase row — it creates (or
  // adopts) the page whose body the public site renders.
  if (intent === "showcase-writeup") {
    const page = await ensurePublicWriteupPage(projectId, auth.user.sub);
    await logAuditEvent({
      action: "page.public-visibility",
      userId: auth.user.sub,
      targetId: page.id,
      metadata: { projectId, publicVisible: true },
      request,
    });
    return redirect(`/projects/${projectId}/public-view`);
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
  values,
  canEdit,
  placeholder,
  className,
}: {
  name: string;
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
    <span className="inline-flex flex-wrap items-center gap-1.5">
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
          aria-label={`Add ${placeholder}`}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-solid"
        >
          <Plus className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}

export default function ProjectPublicView() {
  const data = useLoaderData<typeof loader>();
  const {
    project,
    showcase: s,
    heroPreviewUrl,
    teamMembers,
    writeup,
    canEdit,
    canPublish,
    collabToken,
    userName,
  } = data;
  const navigation = useNavigation();
  const saving = navigation.state !== "idle";

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6 max-w-3xl mx-auto w-full">
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
          <Form method="post" className="flex items-center gap-2">
            <input type="hidden" name="intent" value="showcase-status" />
            <select
              name="status"
              defaultValue={s?.status ?? "NotStarted"}
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
            >
              {STATUSES.map((v) => (
                <option key={v} value={v}>
                  {STATUS_LABELS[v]}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="px-3 py-1.5 text-sm font-medium rounded-md border border-border hover:bg-muted/50 transition-colors"
            >
              Set
            </button>
          </Form>
        )}
      </header>

      {/* The card. Every field is the real one — what you see is the page. */}
      <Form method="post" className="flex flex-col">
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
                values={s?.products ?? []}
                canEdit={canEdit}
                placeholder="Product"
                className="px-2 py-0.5 rounded border border-border text-foreground"
              />
              <ChipList
                name="sectors"
                values={s?.sectors ?? []}
                canEdit={canEdit}
                placeholder="Sector"
                className="px-2 py-0.5 rounded border border-border text-foreground"
              />
              <ChipList
                name="techStack"
                values={s?.techStack ?? []}
                canEdit={canEdit}
                placeholder="Tech"
                className="px-2 py-0.5 rounded border border-border text-foreground"
              />
              <ChipList
                name="partners"
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
                  <span className="text-xs text-accent-coral shrink-0 w-24">{label}</span>
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

      {/* Write-up. The same collab editor the Documents tab uses, so images
          paste and drop in anywhere and the order is whatever you type. */}
      <section className="flex flex-col gap-2 pt-2">
        <h2 className="font-heading font-semibold text-foreground">Write-up</h2>
        {writeup && collabToken ? (
          <>
            <p className="text-xs text-muted-foreground">
              Rendered below the card on dali.website. Paste or drag images
              anywhere in the text; type <code>/</code> for headings, lists,
              quotes, and callouts. Saves as you type.
            </p>
            <div className="border border-border rounded-lg p-3 bg-card">
              <CollaborativeEditor
                documentName={`doc:${writeup.id}:body`}
                editorId={`doc:${writeup.id}:body`}
                token={collabToken}
                userName={userName}
                disabled={!canEdit}
                enableImages
                enableRichBlocks
                enableMentions
                placeholder="Tell the story of this project…"
              />
            </div>
          </>
        ) : writeup ? (
          // Session cookie missing (an expired tab): the editor can't connect,
          // so say so rather than mounting one that silently won't sync.
          <p className="text-sm text-muted-foreground border border-border rounded-lg p-4">
            Reload the page to edit the write-up — your session needs refreshing.
          </p>
        ) : (
          <div className="border border-dashed border-border rounded-lg p-6 text-center flex flex-col items-center gap-3">
            <p className="text-sm text-muted-foreground max-w-md">
              No write-up yet. The card above is all a visitor sees. Start one
              to add the story, screenshots, and results — it becomes a normal
              project document, editable from the Documents tab too.
            </p>
            {canEdit && (
              <Form method="post">
                <input type="hidden" name="intent" value="showcase-writeup" />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Start the write-up
                </button>
              </Form>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
