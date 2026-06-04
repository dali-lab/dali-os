import { useRef, useState } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useRevalidator,
  useSearchParams,
  useSubmit,
} from "react-router";
import { Check, Pencil, X, Settings } from "lucide-react";
import { Modal } from "~/components/Modal";
import { EditableSection } from "~/components/EditableSection";
import { TagPicker } from "~/components/TagPicker";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { PresenceBar } from "~/components/collab/PresenceBar";
import { uploadFileToS3, formatBytes } from "~/lib/upload-client";
import type { Route } from "./+types/projects.$id";
import { prisma } from "~/lib/db";
import { ensureProjectGroup } from "~/lib/groups";
import { requireAuth } from "~/lib/auth";
import { resolvePhotoUrl } from "~/lib/photo";
import { ProjectImageBanner } from "../components/ProjectImageBanner";
import { parseSessionCookie } from "~/lib/cookies";
import { isCore, isProjectMember, canManageStaffing, currentTerm } from "~/lib/roles";
import { getPresenceUser } from "~/lib/presence-user";
import { TaskBoard } from "../components/TaskBoard";
import { type TimelineEpic, type EpicStatus } from "../components/EpicsTimeline";
import {
  EpicSprintManager,
  type EditableEpic,
  type EditableSprint,
} from "../components/EpicSprintManager";
import type {
  TaskBoardOptions,
  TaskCardModel,
  TaskStatus,
  Priority,
} from "../lib/task-board";

export const meta: Route.MetaFunction = ({ data }) => {
  const p = (data as { project?: { name: string } } | undefined)?.project;
  return [{ title: p ? `${p.name} · Projects · DALI OS` : "Project · DALI OS" }];
};

// Open a project document as a split-screen tab. This page renders inside a
// TabWorkspace iframe, so we ask the parent shell to open /documents/:id in a
// second pane beside the project (dali:openTabToSide → Layout). When somehow
// rendered standalone (no iframe), fall back to a normal same-tab navigation.
function openDocumentTab(pageId: string, label: string) {
  const url = `/documents/${pageId}`;
  if (typeof window !== "undefined" && window.self !== window.top) {
    window.parent.postMessage(
      { type: "dali:openTabToSide", url, label },
      window.location.origin,
    );
  } else if (typeof window !== "undefined") {
    window.location.assign(url);
  }
}

const STATUSES = ["Active", "Paused", "Archived"] as const;
type ProjectStatus = (typeof STATUSES)[number];

// "Scope" is no longer a public tab — its domain/term/challenge config moved
// into a settings popup (gated to Core/Admin/Staff). Public tabs are just the
// content views.
const TABS = ["overview", "work"] as const;
type Tab = (typeof TABS)[number];
function isTab(x: string | null): x is Tab {
  return x === "overview" || x === "work";
}

const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  work: "Work",
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      calendarEmail: true,
      teamGroupEmail: true,
      imageUrl: true,
      repoUrls: true,
      deploymentUrl: true,
      githubTeamSlug: true,
      overviewPageId: true,
      prdPageId: true,
      projectTerms: {
        select: { term: { select: { id: true, code: true, sortKey: true } } },
      },
      termCount: true,
      partners: { select: { partnerOrg: { select: { name: true } } } },
      termStatuses: {
        select: {
          id: true,
          isContinuing: true,
          gcalLink: true,
          zoomLink: true,
          sowPageId: true,
          term: { select: { code: true, sortKey: true } },
        },
      },
      assignments: {
        select: {
          level: true,
          user: { select: { id: true, firstName: true, lastName: true } },
          term: { select: { code: true, sortKey: true } },
          domain: { select: { id: true, name: true } },
        },
      },
      epics: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          startsAt: true,
          endsAt: true,
          descriptionDocId: true,
          stories: {
            orderBy: { position: "asc" },
            select: { id: true, title: true, notes: true, status: true },
          },
        },
      },
      sprints: {
        orderBy: { startsAt: "asc" },
        select: {
          id: true,
          name: true,
          startsAt: true,
          endsAt: true,
          status: true,
          epicId: true,
        },
      },
      tasks: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          position: true,
          dueAt: true,
          epicId: true,
          sprintId: true,
          domain: { select: { id: true, displayName: true } },
          assignees: {
            select: {
              user: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      },
      // Declared domains for this project — editable from the Overview tab.
      // Distinct from per-assignment domains (which describe who's actually
      // staffed in which domain this term).
      domains: {
        select: { domain: { select: { id: true, displayName: true } } },
      },
    },
  });
  if (!project) throw new Response("Not found", { status: 404 });

  // Project documents — top-level, non-archived FreeForm Pages scoped to
  // this project's workspace.
  const documentRows = await prisma.page.findMany({
    where: {
      workspaceType: "Project",
      workspaceId: project.id,
      parentPageId: null,
      archivedAt: null,
    },
    orderBy: { position: "asc" },
    select: {
      id: true,
      title: true,
      tags: { select: { tag: { select: { id: true, label: true, slug: true, color: true } } } },
    },
  });
  const documents = documentRows.map((d) => ({
    id: d.id,
    title: d.title,
    tags: d.tags.map((t) => t.tag).sort((a, b) => a.label.localeCompare(b.label)),
  }));

  // Project files — standalone uploads with their current version + tags.
  const fileRows = await prisma.projectFile.findMany({
    where: { projectId: project.id, archivedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      currentVersion: { select: { fileName: true, sizeBytes: true } },
      _count: { select: { versions: true } },
      tags: { select: { tag: { select: { id: true, label: true, slug: true, color: true } } } },
    },
  });
  const files = fileRows.map((f) => ({
    id: f.id,
    title: f.title,
    fileName: f.currentVersion?.fileName ?? null,
    sizeBytes: f.currentVersion?.sizeBytes ?? null,
    versionCount: f._count.versions,
    tags: f.tags.map((t) => t.tag).sort((a, b) => a.label.localeCompare(b.label)),
  }));

  // Lab-wide active tags, for the tag pickers on docs and files.
  const allTags = await prisma.docTag.findMany({
    where: { archivedAt: null },
    orderBy: { label: "asc" },
    select: { id: true, label: true, slug: true, color: true },
  });

  // Content edits (name/status, description, details, docs/files, epics/
  // sprints/tasks) are open to Core/Admin *and* anyone staffed on this project
  // in any term. Scope/domain settings stay Core/Admin only (canEditScope).
  const core = await isCore(auth.user.sub);
  const canEditScope = core;
  const canEdit = core || (await isProjectMember(auth.user.sub, params.id));
  // The Scope/challenge settings popup is visible to Core, Admin, or staffing
  // leads. Editing still requires canEditScope (isCore) — the action enforces that.
  const canViewScope = canEditScope || (await canManageStaffing(auth.user.sub));

  // Collab editor wiring (same as the hiring routes): session cookie is the
  // WebSocket auth token; userName labels the presence cursor.
  const collabToken = parseSessionCookie(request);
  const fallbackName =
    [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") ||
    auth.user.email;
  const presenceUser = await getPresenceUser(auth.user.sub, fallbackName);
  const userName = presenceUser?.name ?? fallbackName;

  // Timeline span: prefer the epic's explicit startsAt/endsAt; fall back to
  // the min/max of its sprint dates when either is unset. Each epic also
  // carries its own sprint rows (ordered by start) so the timeline can render
  // one bar per sprint with connectors, not just a single epic bar.
  const epics: TimelineEpic[] = project.epics.map((e) => {
    const epicSprints = project.sprints
      .filter((s) => s.epicId === e.id)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const starts = epicSprints.map((s) => s.startsAt.getTime());
    const ends = epicSprints.map((s) => s.endsAt.getTime());
    const sprintStart = starts.length ? new Date(Math.min(...starts)).toISOString() : null;
    const sprintEnd = ends.length ? new Date(Math.max(...ends)).toISOString() : null;
    return {
      id: e.id,
      title: e.title,
      status: e.status as EpicStatus,
      startsAt: e.startsAt ? e.startsAt.toISOString() : sprintStart,
      endsAt: e.endsAt ? e.endsAt.toISOString() : sprintEnd,
      sprintCount: epicSprints.length,
      sprints: epicSprints.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status as TimelineEpic["sprints"][number]["status"],
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
      })),
    };
  });

  const editableEpics: EditableEpic[] = project.epics.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    status: e.status as EditableEpic["status"],
    startsAt: e.startsAt ? e.startsAt.toISOString() : null,
    endsAt: e.endsAt ? e.endsAt.toISOString() : null,
    descriptionDocId: e.descriptionDocId,
    stories: e.stories.map((s) => ({
      id: s.id,
      title: s.title,
      notes: s.notes,
      status: s.status as EditableEpic["stories"][number]["status"],
    })),
  }));

  const sprints: EditableSprint[] = project.sprints.map((s) => ({
    id: s.id,
    name: s.name,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    status: s.status as EditableSprint["status"],
    epicId: s.epicId,
  }));

  const tasks: TaskCardModel[] = project.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status as TaskStatus,
    priority: t.priority as Priority,
    position: t.position,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    epicId: t.epicId,
    sprintId: t.sprintId,
    assignees: t.assignees.map((a) => ({
      id: a.user.id,
      name: `${a.user.firstName} ${a.user.lastName}`.trim(),
    })),
    domain: t.domain
      ? { id: t.domain.id, name: t.domain.displayName }
      : null,
  }));

  // Board option lists for the TaskModal: members assignable on this project
  // (deduped across terms — same person across multiple terms shows once) and
  // every active domain.
  const memberMap = new Map<string, string>();
  for (const a of project.assignments) {
    const id = a.user.id;
    if (!memberMap.has(id)) {
      memberMap.set(id, `${a.user.firstName} ${a.user.lastName}`.trim());
    }
  }
  const boardOptions: TaskBoardOptions = {
    members: [...memberMap.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    domains: (
      await prisma.domain.findMany({
        where: { active: true },
        orderBy: { displayName: "asc" },
        select: { id: true, displayName: true },
      })
    ).map((d) => ({ id: d.id, name: d.displayName })),
  };

  // Team grouped by term, newest term first. Current = highest sortKey.
  const teamByTerm = new Map<
    string,
    { code: string; sortKey: number; members: { name: string; domain: string; level: string }[] }
  >();
  for (const a of project.assignments) {
    const key = a.term.code;
    if (!teamByTerm.has(key)) {
      teamByTerm.set(key, { code: a.term.code, sortKey: a.term.sortKey, members: [] });
    }
    teamByTerm.get(key)!.members.push({
      name: `${a.user.firstName} ${a.user.lastName}`.trim(),
      domain: a.domain.name,
      level: a.level,
    });
  }
  const teams = [...teamByTerm.values()].sort((a, b) => b.sortKey - a.sortKey);

  const termStatuses = [...project.termStatuses].sort(
    (a, b) => b.term.sortKey - a.term.sortKey,
  );

  // Domain editor option list + fallback-from-staffing data. The detail page
  // displays declared domains directly; if none are declared, it falls back
  // to the union of domains seen on this project's bids + assignments so a
  // project that's actively being staffed still shows its domain footprint.
  const [allDomains, bidDomains, allTerms] = await Promise.all([
    prisma.domain.findMany({
      where: { active: true },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true },
    }),
    prisma.staffingPreference.findMany({
      where: { projectId: project.id },
      select: { domainId: true },
      distinct: ["domainId"],
    }),
    prisma.term.findMany({
      orderBy: { sortKey: "desc" },
      select: { id: true, code: true },
    }),
  ]);
  const declaredDomains = project.domains.map((d) => ({
    id: d.domain.id,
    name: d.domain.displayName,
  }));

  // The project's term set is now explicit (ProjectTerm rows), editable on
  // this page, and need not be consecutive. Sorted descending so the display
  // surfaces the most recent term first; the scope grid uses this same set.
  const plannedTerms = project.projectTerms
    .map((pt) => pt.term)
    .sort((a, b) => b.sortKey - a.sortKey);

  // Start term is derived as the earliest term in the set (lowest sortKey),
  // not a stored field. Null when the project has no terms yet.
  const startTerm =
    plannedTerms.length > 0 ? plannedTerms[plannedTerms.length - 1] : null;

  // Active-this-term is derived from membership: the project is active iff the
  // current term is in its set. Distinct from the manual status enum
  // (Paused/Archived), which the lead still controls explicitly.
  const current = await currentTerm();
  const isActiveThisTerm =
    current !== null && plannedTerms.some((t) => t.id === current.id);

  // Fetch all scope rows for this project (small N — at most |declared| ×
  // termCount, both single-digit in practice). Keyed by domainId+termId so
  // the UI can index in O(1) when building the grid.
  const scopeRows = await prisma.projectDomainScope.findMany({
    where: { projectId: project.id },
    select: { domainId: true, termId: true, scope: true },
  });
  const scopeByCell = new Map<string, string>();
  for (const r of scopeRows) {
    scopeByCell.set(`${r.domainId}:${r.termId}`, r.scope);
  }
  // Grid: one entry per (declared domain, planned term) cell, with the
  // current scope text (empty string if no row exists).
  const domainScopeGrid = declaredDomains.flatMap((d) =>
    plannedTerms.map((t) => ({
      domainId: d.id,
      domainName: d.name,
      termId: t.id,
      termCode: t.code,
      scope: scopeByCell.get(`${d.id}:${t.id}`) ?? "",
    })),
  );
  // Derived fallback: union of (declared) + (bid domains) + (assignment domains).
  // Used only when declaredDomains is empty.
  const derivedDomainIds = new Set<string>();
  for (const b of bidDomains) derivedDomainIds.add(b.domainId);
  for (const a of project.assignments) {
    const dom = (a.domain as { id?: string } | null)?.id;
    if (dom) derivedDomainIds.add(dom);
  }
  const idToName = new Map(allDomains.map((d) => [d.id, d.displayName]));
  const derivedDomains = [...derivedDomainIds]
    .map((id) => ({ id, name: idToName.get(id) ?? "(unknown)" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // imageUrl may be an S3 key (uploaded via the project image control) or a
  // legacy pasted URL; resolve to a displayable src. The raw value stays on
  // project.imageUrl so the upload field round-trips the key on save.
  const imageUrlResolved = await resolvePhotoUrl(project.imageUrl);

  return {
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      calendarEmail: project.calendarEmail,
      teamGroupEmail: project.teamGroupEmail,
      imageUrl: project.imageUrl,
      imageUrlResolved,
      repoUrls: project.repoUrls,
      deploymentUrl: project.deploymentUrl,
      githubTeamSlug: project.githubTeamSlug,
      overviewPageId: project.overviewPageId,
      prdPageId: project.prdPageId,
      startTerm,
      // Full term set, chronological (earliest first) so the header can list
      // every term the project runs rather than just the start term.
      terms: [...plannedTerms]
        .reverse()
        .map((t) => ({ id: t.id, code: t.code })),
      isActiveThisTerm,
      actualTermCount: plannedTerms.length,
      termCount: project.termCount,
      partners: project.partners,
      domains: declaredDomains,
      derivedDomains,
    },
    allDomainOptions: allDomains.map((d) => ({ id: d.id, name: d.displayName })),
    plannedTerms: plannedTerms.map((t) => ({ id: t.id, code: t.code })),
    allTermOptions: allTerms,
    domainScopeGrid,
    teams,
    termStatuses,
    documents,
    files,
    allTags,
    epics,
    editableEpics,
    sprints,
    tasks,
    boardOptions,
    canEdit,
    canEditScope,
    canViewScope,
    currentTerm: current ? { id: current.id, code: current.code } : null,
    collabToken,
    userName,
    currentUserId: auth.user.sub,
    presencePhotoUrl: presenceUser?.photoUrl ?? null,
    presenceSubtitle: presenceUser?.subtitle ?? null,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");

  // Content edits are open to Core/Admin or anyone staffed on the project;
  // scope/domain settings (scopesBulk, domains, terms) stay Core/Admin only.
  const core = await isCore(auth.user.sub);
  if (!core && !(await isProjectMember(auth.user.sub, params.id))) {
    return { error: "You don't have permission to edit this project." };
  }

  const form = await request.formData();
  const intent = (form.get("intent") as string | null) ?? "details";

  const SCOPE_INTENTS = ["scopesBulk", "domains", "terms"];
  if (SCOPE_INTENTS.includes(intent) && !core) {
    return { error: "Only Core or Admin can change domain settings." };
  }

  // Header form: name + status only.
  if (intent === "header") {
    const name = (form.get("name") as string | null)?.trim() ?? "";
    const status = (form.get("status") as string | null) ?? "";
    if (!name) return { error: "Project name is required." };
    if (!STATUSES.includes(status as ProjectStatus)) {
      return { error: "Invalid status." };
    }
    await prisma.project.update({
      where: { id: params.id },
      data: { name, status: status as ProjectStatus },
    });
    await ensureProjectGroup(params.id, name);
    return redirect(`/projects/${params.id}`);
  }

  // Description segment: its own form/submit so it doesn't blank the other
  // detail fields.
  if (intent === "description") {
    const descriptionRaw = (form.get("description") as string | null)?.trim() ?? "";
    await prisma.project.update({
      where: { id: params.id },
      data: { description: descriptionRaw === "" ? null : descriptionRaw },
    });
    return redirect(`/projects/${params.id}`);
  }

  // Image-only update: the banner saves immediately on upload (its own fetcher),
  // independent of the details form. Same gate as above (already checked).
  if (intent === "update-image") {
    const imageUrlRaw = (form.get("imageUrl") as string | null)?.trim() ?? "";
    await prisma.project.update({
      where: { id: params.id },
      data: { imageUrl: imageUrlRaw === "" ? null : imageUrlRaw },
    });
    return redirect(`/projects/${params.id}`);
  }

  // Per-(domain, term) scope cells. Bulk write: the form names cells as
  // "scope:<domainId>:<termId>" so a single Save commits every cell at
  // once. Empty values delete the row to keep the table tidy. A stale
  // domainId/termId is silently dropped rather than erroring so a partial
  // form (e.g. domain unlisted after first render) doesn't 500.
  if (intent === "scopesBulk") {
    type CellWrite = { domainId: string; termId: string; scope: string };
    const writes: CellWrite[] = [];
    for (const [key, value] of form.entries()) {
      if (!key.startsWith("scope:")) continue;
      const [, domainId, termId] = key.split(":");
      if (!domainId || !termId) continue;
      writes.push({ domainId, termId, scope: String(value).trim() });
    }
    if (writes.length === 0) {
      return redirect(`/projects/${params.id}`);
    }
    const ops = writes.map(({ domainId, termId, scope }) =>
      scope === ""
        ? prisma.projectDomainScope.deleteMany({
            where: { projectId: params.id, domainId, termId },
          })
        : prisma.projectDomainScope.upsert({
            where: {
              projectId_domainId_termId: {
                projectId: params.id,
                domainId,
                termId,
              },
            },
            update: { scope, updatedById: auth.user.sub },
            create: {
              projectId: params.id,
              domainId,
              termId,
              scope,
              updatedById: auth.user.sub,
            },
          }),
    );
    await prisma.$transaction(ops);
    return redirect(`/projects/${params.id}`);
  }

  // Declared domains for this project. Full-replacement: incoming set wins.
  // Filtered down to active, real Domain ids so a stale dropdown value can't
  // create orphan rows. Wrapped in a transaction so a partial failure leaves
  // the project's domain list untouched.
  if (intent === "domains") {
    const incoming = form.getAll("domainId").map((v) => String(v));
    const valid = incoming.length
      ? await prisma.domain.findMany({
          where: { id: { in: incoming }, active: true },
          select: { id: true },
        })
      : [];
    const ids = valid.map((d) => d.id);
    await prisma.$transaction([
      prisma.projectDomain.deleteMany({ where: { projectId: params.id } }),
      ...(ids.length
        ? [
            prisma.projectDomain.createMany({
              data: ids.map((domainId) => ({ projectId: params.id, domainId })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
    return redirect(`/projects/${params.id}`);
  }

  // Project term set. Full-replacement: the incoming set of termIds wins, so
  // the same handler covers both adding and removing terms. Filtered to real
  // Term ids so a stale value can't create an orphan row. The start term and
  // active-this-term are derived from this set, not stored. Mirrors the
  // `domains` handler above.
  if (intent === "terms") {
    const incoming = form.getAll("termId").map((v) => String(v));
    const valid = incoming.length
      ? await prisma.term.findMany({
          where: { id: { in: incoming } },
          select: { id: true },
        })
      : [];
    const ids = valid.map((t) => t.id);
    await prisma.$transaction([
      prisma.projectTerm.deleteMany({ where: { projectId: params.id } }),
      ...(ids.length
        ? [
            prisma.projectTerm.createMany({
              data: ids.map((termId) => ({ projectId: params.id, termId })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
    return redirect(`/projects/${params.id}`);
  }

  // Details form: calendar email, repos, deployment. (Description, name/status,
  // and the image banner are saved by their own segments above.)
  const calendarEmailRaw = (form.get("calendarEmail") as string | null)?.trim() ?? "";
  const repoUrlsRaw = (form.get("repoUrls") as string | null) ?? "";
  const deploymentUrlRaw = (form.get("deploymentUrl") as string | null)?.trim() ?? "";
  const termCountRaw = (form.get("termCount") as string | null) ?? "";
  const githubTeamRaw = (form.get("githubTeamSlug") as string | null)?.trim() ?? "";

  // Normalize to a GitHub-safe team slug: lowercase, non-alphanumerics → single
  // hyphens, trimmed. Empty clears the field (automation then skips).
  const githubTeamSlug =
    githubTeamRaw === ""
      ? null
      : githubTeamRaw
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");

  // repoUrls textarea: one URL per line, blanks dropped.
  const repoUrls = repoUrlsRaw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  // termCount is the *expected* span length (≥1), an independent target; the
  // actual terms live in the ProjectTerm set (intent=terms). Blank/invalid
  // falls back to 1 rather than erroring the whole form.
  const termCount = Math.max(1, Math.floor(Number(termCountRaw)) || 1);

  await prisma.project.update({
    where: { id: params.id },
    data: {
      calendarEmail: calendarEmailRaw === "" ? null : calendarEmailRaw,
      repoUrls,
      deploymentUrl: deploymentUrlRaw === "" ? null : deploymentUrlRaw,
      termCount,
      githubTeamSlug,
    },
  });
  return redirect(`/projects/${params.id}`);
}

export default function ProjectDetail() {
  const {
    project,
    teams,
    documents,
    files,
    allTags,
    epics,
    editableEpics,
    sprints,
    tasks,
    boardOptions,
    allDomainOptions,
    plannedTerms,
    allTermOptions,
    domainScopeGrid,
    canEdit,
    canEditScope,
    canViewScope,
    currentTerm,
    collabToken,
    userName,
    currentUserId,
    presencePhotoUrl,
    presenceSubtitle,
  } = useLoaderData() as LoaderData;
  const actionData = useActionData<typeof action>();
  const [scopeSettingsOpen, setScopeSettingsOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const partnerNames = project.partners.map((p) => p.partnerOrg.name);

  const tabParam = searchParams.get("tab");
  const tab: Tab = isTab(tabParam) ? tabParam : "overview";
  const setTab = (next: Tab) => {
    setSearchParams(
      (prev) => {
        prev.set("tab", next);
        return prev;
      },
      { replace: true },
    );
  };

  const page = (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end gap-3">
        <PresenceBar />
      </div>

      {/* Overview header — always on top, not behind a tab */}
      <ProjectHeader
        project={project}
        partnerNames={partnerNames}
        canEdit={canEdit}
      />

      {/* Tab bar. Each section now owns its own edit button — there's no
          page-level edit mode left to clear when switching tabs. */}
      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-accent-coral text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
        {/* Scope/challenge config lives behind this gear, visible only to
            Core/Admin/Staff. */}
        {canViewScope && (
          <button
            type="button"
            onClick={() => setScopeSettingsOpen(true)}
            className="ml-auto -mb-px inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            title="Domain settings & challenges"
          >
            <Settings className="w-4 h-4" />
            <span className="hidden sm:inline">Domain settings</span>
          </button>
        )}
      </div>

      {tab === "overview" && (
        <OverviewTab
          project={project}
          teams={teams}
          documents={documents}
          files={files}
          allTags={allTags}
          canEdit={canEdit}
          domainScopeGrid={domainScopeGrid}
          currentTerm={currentTerm}
          actionError={actionData?.error}
        />
      )}

      {/* Scope & challenges, now a settings popup gated to Core/Admin/Staff. */}
      {canViewScope && (
        <Modal
          open={scopeSettingsOpen}
          onClose={() => setScopeSettingsOpen(false)}
          labelledBy="scope-settings-title"
          containerClassName="bg-card rounded-2xl shadow-xl w-full max-w-4xl p-5 sm:p-6 my-auto max-h-[85vh] overflow-y-auto"
        >
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2 id="scope-settings-title" className="font-heading text-lg font-bold text-foreground">
                Domain settings
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Declared domains, planned terms, and the per-domain challenge
                for each term.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setScopeSettingsOpen(false)}
              aria-label="Close scope settings"
              className="text-muted-foreground hover:text-foreground text-xl leading-none px-1"
            >
              ×
            </button>
          </div>
          <ScopeTab
            project={project}
            allDomainOptions={allDomainOptions}
            plannedTerms={plannedTerms}
            allTermOptions={allTermOptions}
            domainScopeGrid={domainScopeGrid}
            canEdit={canEditScope}
            actionError={actionData?.error}
          />
        </Modal>
      )}

      {tab === "work" && (
        // Work tab keys off the raw edit permission, not the page-level
        // Edit-mode toggle: epics/sprints/tasks each gate their own inline
        // edit affordances, so there's nothing to "turn on" first.
        <WorkTab
          projectId={project.id}
          epics={epics}
          editableEpics={editableEpics}
          sprints={sprints}
          tasks={tasks}
          boardOptions={boardOptions}
          canEdit={canEdit}
          collabToken={collabToken}
          userName={userName}
        />
      )}
    </div>
  );

  return collabToken ? (
    <PresenceProvider
      pageId={`project:${project.id}`}
      token={collabToken}
      userName={userName}
      userId={currentUserId}
      photoUrl={presencePhotoUrl}
      subtitle={presenceSubtitle}
    >
      {page}
    </PresenceProvider>
  ) : (
    page
  );
}

// loader returns `redirect()` (a Response) on the auth-fail branches; the
// component only ever renders with the data branch, so narrow it out here.
type LoaderData = Exclude<Awaited<ReturnType<typeof loader>>, Response>;

function ProjectHeader({
  project,
  partnerNames,
  canEdit,
}: {
  project: LoaderData["project"];
  partnerNames: string[];
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  // Actual terms vs the expected span: when they differ, show "N of M" so a
  // partially-scheduled project reads as such. termCount is the expected target.
  const actualTermCount = project.actualTermCount;
  const termCountLabel =
    actualTermCount === project.termCount
      ? `${project.termCount} ${project.termCount === 1 ? "term" : "terms"}`
      : `${actualTermCount} of ${project.termCount} terms`;

  const termsLabel =
    project.terms.length > 0
      ? project.terms.map((t) => t.code).join(", ")
      : "No terms yet";

  const subtitle = (
    <p className="text-sm text-muted-foreground mt-1">
      {termsLabel}
      {" · "}
      {termCountLabel}
      {" · "}
      <span className={project.isActiveThisTerm ? "text-accent-green" : undefined}>
        {project.isActiveThisTerm ? "Active this term" : "Not this term"}
      </span>
      {" · "}
      {partnerNames.length > 0 ? partnerNames.join(", ") : "No partners"}
    </p>
  );

  return (
    <header className="flex flex-col gap-4">
      <ProjectImageBanner
        projectId={project.id}
        projectName={project.name}
        initialPreviewUrl={project.imageUrlResolved}
        canEdit={canEdit}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div key={resetKey} className="flex items-center gap-2 flex-wrap">
            {editing && canEdit ? (
              <Form
                method="post"
                ref={formRef}
                className="flex items-center gap-2 flex-wrap"
              >
                <input type="hidden" name="intent" value="header" />
                <input
                  name="name"
                  defaultValue={project.name}
                  aria-label="Project name"
                  autoFocus
                  className="font-heading text-xl font-bold text-foreground px-2 py-1 border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                />
                <select
                  name="status"
                  defaultValue={project.status}
                  aria-label="Project status"
                  className="text-xs px-2 py-1 border border-border rounded-full bg-background text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Form>
            ) : (
              <>
                <h1 className="font-heading text-2xl font-bold text-foreground">
                  {project.name}
                </h1>
                <span className="text-[11px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">
                  {project.status}
                </span>
              </>
            )}

            {/* Domain chips at a glance. Falls back to the derived set (bids
                + assignments) so a project that hasn't declared anything yet
                still telegraphs its staffing footprint. */}
            {!editing &&
              (project.domains.length > 0 ? (
                <DomainChips items={project.domains} />
              ) : project.derivedDomains.length > 0 ? (
                <DomainChips items={project.derivedDomains} muted />
              ) : null)}
          </div>

          {canEdit && (
            <div className="flex items-center gap-1.5 shrink-0">
              {editing ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setResetKey((k) => k + 1);
                      setEditing(false);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (formRef.current) submit(formRef.current);
                      setEditing(false);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Save
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  aria-label="Edit project name and status"
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </button>
              )}
            </div>
          )}
        </div>
        {subtitle}
      </div>
    </header>
  );
}

function DescriptionSegment({
  description,
  canEdit,
}: {
  description: string | null;
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <EditableSection
      title="Description"
      canEdit={canEdit}
      onSave={() => { if (formRef.current) submit(formRef.current); }}
    >
      {({ editing }) =>
        editing ? (
          <Form method="post" ref={formRef} className="flex flex-col gap-2">
            <input type="hidden" name="intent" value="description" />
            <textarea
              name="description"
              rows={4}
              defaultValue={description ?? ""}
              placeholder="Add a short description…"
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              autoFocus
            />
          </Form>
        ) : description ? (
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {description}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No description.
          </p>
        )
      }
    </EditableSection>
  );
}

// Declared-domain editor for the project. Multi-select via checkboxes (3–8
// active domains; click-to-toggle reads faster than a multi-select). Saves
// the full set on every toggle so the row order doesn't matter and a stale
// optimistic state can't accumulate. When no domains are declared and the
// project has bids/assignments, the derived union is shown read-only as a
// hint so the user can see what staffing has implied so far.
function DomainsSegment({
  declared,
  derived,
  allDomains,
  canEdit,
}: {
  declared: { id: string; name: string }[];
  derived: { id: string; name: string }[];
  allDomains: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <EditableSection
      title="Domains"
      canEdit={canEdit}
      onSave={() => { if (formRef.current) submit(formRef.current); }}
    >
      {({ editing, resetKey }) =>
        editing ? (
          // Controlled chip toggles. The previous markup wrapped a hidden
          // checkbox in a styled <label> and keyed the chip's "selected"
          // styling off the prop-derived `isOn` — clicking the label
          // toggled the checkbox in the DOM but `isOn` (a render closure)
          // never re-read it, so the chip looked unchanged. Now an explicit
          // local Set tracks selection, the chip is a <button>, and the
          // form's `domainId` entries are emitted as hidden inputs at
          // submit time. `resetKey` (bumped by EditableSection on Cancel)
          // is the dependency that resets state back to `declared`.
          <DomainsChipsEditor
            key={resetKey}
            formRef={formRef}
            initialSelectedIds={declared.map((d) => d.id)}
            allDomains={allDomains}
            derived={derived}
            declaredCount={declared.length}
          />
        ) : declared.length > 0 ? (
          <DomainChips items={declared} />
        ) : derived.length > 0 ? (
          <>
            <DomainChips items={derived} muted />
            <p className="text-xs text-muted-foreground mt-2">
              Derived from current bids and assignments — no domains have
              been declared on the project yet.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground italic">No domains.</p>
        )
      }
    </EditableSection>
  );
}

function DomainsChipsEditor({
  formRef,
  initialSelectedIds,
  allDomains,
  derived,
  declaredCount,
}: {
  formRef: React.MutableRefObject<HTMLFormElement | null>;
  initialSelectedIds: string[];
  allDomains: { id: string; name: string }[];
  derived: { id: string; name: string }[];
  declaredCount: number;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelectedIds),
  );
  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <Form method="post" ref={formRef} className="flex flex-col gap-2">
      <input type="hidden" name="intent" value="domains" />
      {/* Selected ids are submitted as repeated form fields the action
          collects via form.getAll("domainId"). */}
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="domainId" value={id} />
      ))}
      <div className="flex flex-wrap gap-2">
        {allDomains.map((d) => {
          const isOn = selected.has(d.id);
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => toggle(d.id)}
              aria-pressed={isOn}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-sm cursor-pointer transition-colors ${
                isOn
                  ? "bg-accent-coral/15 border-accent-coral/40 text-foreground"
                  : "bg-background border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {d.name}
            </button>
          );
        })}
      </div>
      {derived.length > 0 && declaredCount === 0 && (
        <p className="text-xs text-muted-foreground">
          No domains declared yet — current bids and assignments suggest:{" "}
          <span className="text-foreground">
            {derived.map((d) => d.name).join(", ")}
          </span>
          .
        </p>
      )}
    </Form>
  );
}

// Project terms — the editable term set (source of truth for which terms the
// project runs). Same click-to-toggle, save-the-full-set pattern as Domains;
// the action's intent=terms handler full-replaces ProjectTerm rows. The start
// term and "active this term" are derived from this set, so no separate
// start-term field is edited here. `expected` (termCount) is edited in the
// Details section and shown here only as a target for context.
function TermsSegment({
  selected,
  allTerms,
  expected,
  canEdit,
}: {
  selected: { id: string; code: string }[];
  allTerms: { id: string; code: string }[];
  expected: number;
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <EditableSection
      title="Terms"
      canEdit={canEdit}
      onSave={() => { if (formRef.current) submit(formRef.current); }}
    >
      {({ editing, resetKey }) =>
        editing ? (
          <TermsChipsEditor
            key={resetKey}
            formRef={formRef}
            initialSelectedIds={selected.map((t) => t.id)}
            allTerms={allTerms}
            expected={expected}
          />
        ) : selected.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-blue-50 text-blue-700 border border-blue-100"
              >
                {t.code}
              </span>
            ))}
            {selected.length !== expected && (
              <span className="text-xs text-muted-foreground self-center">
                {selected.length} of {expected} expected
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No terms yet{expected > 0 ? ` — ${expected} expected` : ""}.
          </p>
        )
      }
    </EditableSection>
  );
}

function TermsChipsEditor({
  formRef,
  initialSelectedIds,
  allTerms,
  expected,
}: {
  formRef: React.MutableRefObject<HTMLFormElement | null>;
  initialSelectedIds: string[];
  allTerms: { id: string; code: string }[];
  expected: number;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelectedIds),
  );
  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <Form method="post" ref={formRef} className="flex flex-col gap-2">
      <input type="hidden" name="intent" value="terms" />
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="termId" value={id} />
      ))}
      <div className="flex flex-wrap gap-2">
        {allTerms.map((t) => {
          const isOn = selected.has(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => toggle(t.id)}
              aria-pressed={isOn}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-sm cursor-pointer transition-colors ${
                isOn
                  ? "bg-accent-coral/15 border-accent-coral/40 text-foreground"
                  : "bg-background border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.code}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {selected.size} selected · {expected} expected. The start term is the
        earliest selected; the project shows as active when the current term is
        selected.
      </p>
    </Form>
  );
}

// Calendar email + image URL + term count + repo URLs. One form posting
// intent=details with the full field set, so the action handler stays
// unchanged. Section-level Save submits; Cancel reverts via the wrapper.
function DetailsSegment({
  project,
  canEdit,
}: {
  project: LoaderData["project"];
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <EditableSection
      title="Project details"
      canEdit={canEdit}
      onSave={() => { if (formRef.current) submit(formRef.current); }}
    >
      {({ editing }) => (
        <Form method="post" ref={formRef} className="flex flex-col gap-4 w-full">
          <input type="hidden" name="intent" value="details" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Calendar email</span>
              {editing ? (
                <input
                  name="calendarEmail"
                  type="email"
                  defaultValue={project.calendarEmail ?? ""}
                  placeholder="projectname@dali.dartmouth.edu"
                  className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                />
              ) : (
                <span className="px-2 py-1.5 text-sm text-foreground">
                  {project.calendarEmail ?? "—"}
                </span>
              )}
            </label>

            {/* Team email group — provisioned by the staffing "Create team email
                group" automation; read-only here (not lead-editable). */}
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Team email group</span>
              <span className="px-2 py-1.5 text-sm">
                {project.teamGroupEmail ? (
                  <a
                    href={`mailto:${project.teamGroupEmail}`}
                    className="text-accent-coral hover:underline break-all"
                  >
                    {project.teamGroupEmail}
                  </a>
                ) : (
                  <span className="text-muted-foreground">
                    Not created yet — run staffing finalize.
                  </span>
                )}
              </span>
            </label>


            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">GitHub team</span>
              {editing ? (
                <input
                  name="githubTeamSlug"
                  type="text"
                  defaultValue={project.githubTeamSlug ?? ""}
                  placeholder="project-team-name"
                  className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                />
              ) : (
                <span className="px-2 py-1.5 text-sm text-foreground">
                  {project.githubTeamSlug ?? "—"}
                </span>
              )}
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">
                Terms required (planned span)
              </span>
              {editing ? (
                <input
                  name="termCount"
                  type="number"
                  min={1}
                  defaultValue={project.termCount}
                  className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                />
              ) : (
                <span className="px-2 py-1.5 text-sm text-foreground">
                  {project.termCount}{" "}
                  {project.termCount === 1 ? "term" : "terms"}
                </span>
              )}
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">
              Repositories (one URL per line)
            </span>
            {editing ? (
              <textarea
                name="repoUrls"
                rows={3}
                defaultValue={project.repoUrls.join("\n")}
                placeholder="https://github.com/dali-lab/…"
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 font-mono"
              />
            ) : project.repoUrls.length > 0 ? (
              <ul className="flex flex-col gap-1 px-2 py-1.5">
                {project.repoUrls.map((url) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-accent-coral hover:underline break-all"
                    >
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="px-2 py-1.5 text-sm text-muted-foreground">
                —
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Deployment</span>
            {editing ? (
              <input
                name="deploymentUrl"
                type="url"
                defaultValue={project.deploymentUrl ?? ""}
                placeholder="https://projectname.fly.dev"
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 font-mono"
              />
            ) : project.deploymentUrl ? (
              <a
                href={project.deploymentUrl}
                target="_blank"
                rel="noreferrer"
                className="px-2 py-1.5 text-sm text-accent-coral hover:underline break-all"
              >
                {project.deploymentUrl}
              </a>
            ) : (
              <span className="px-2 py-1.5 text-sm text-muted-foreground">—</span>
            )}
          </label>
        </Form>
      )}
    </EditableSection>
  );
}

// Per-(domain, term) scope grid. One Edit button for the whole section;
// Save commits every cell at once via intent=scopesBulk. Empty cells in
// the submitted set delete their row server-side.
function DomainScopesSegment({
  domains,
  terms,
  grid,
  canEdit,
}: {
  domains: { id: string; name: string }[];
  terms: { id: string; code: string }[];
  grid: {
    domainId: string;
    domainName: string;
    termId: string;
    termCode: string;
    scope: string;
  }[];
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);
  const cell = (domainId: string, termId: string): string =>
    grid.find((c) => c.domainId === domainId && c.termId === termId)?.scope ??
    "";

  return (
    <EditableSection
      title="Domain challenges"
      description="Free-text challenge brief for each declared domain in each planned term."
      canEdit={canEdit}
      onSave={() => { if (formRef.current) submit(formRef.current); }}
    >
      {({ editing }) => (
        <Form method="post" ref={formRef} className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="scopesBulk" />
          {terms.map((t) => (
            <div key={t.id} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-foreground">{t.code}</h3>
              <div className="flex flex-col gap-3">
                {domains.map((d) => {
                  const value = cell(d.id, t.id);
                  return (
                    <div
                      key={`${d.id}:${t.id}`}
                      className="rounded-md border border-border p-2 flex flex-col gap-1"
                    >
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {d.name}
                      </span>
                      {editing ? (
                        <textarea
                          name={`scope:${d.id}:${t.id}`}
                          defaultValue={value}
                          rows={3}
                          placeholder="+ Add challenge"
                          className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 resize-y"
                        />
                      ) : value ? (
                        <p className="text-sm text-foreground whitespace-pre-wrap">
                          {value}
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">
                          No challenge.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </Form>
      )}
    </EditableSection>
  );
}

function DomainChips({
  items,
  muted = false,
}: {
  items: { id: string; name: string }[];
  muted?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((d) => (
        <span
          key={d.id}
          className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded ${
            muted
              ? "bg-muted text-muted-foreground"
              : "bg-blue-50 text-blue-700 border border-blue-100"
          }`}
        >
          {d.name}
        </span>
      ))}
    </div>
  );
}

function TeamSection({ teams }: { teams: LoaderData["teams"] }) {
  const [showAll, setShowAll] = useState(false);
  // teams is pre-sorted newest term first by the loader.
  const visible = showAll ? teams : teams.slice(0, 1);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Team</span>
        {teams.length > 1 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-xs font-medium text-accent-coral hover:underline"
          >
            {showAll ? "Show less" : `Show all (${teams.length} terms)`}
          </button>
        )}
      </div>
      {teams.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No team assignments yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((team) => (
            <div key={team.code}>
              <div className="text-xs font-medium text-muted-foreground mb-1.5">
                {team.code}
                {team.code === teams[0].code && (
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-accent-teal/15 text-accent-teal">
                    Current
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {team.members.map((m, j) => (
                  <span
                    key={j}
                    className="text-xs px-2 py-1 rounded-md border border-border text-foreground"
                  >
                    {m.name}
                    <span className="text-muted-foreground">
                      {" "}
                      · {m.domain} {m.level}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OverviewTab({
  project,
  teams,
  documents,
  files,
  allTags,
  canEdit,
  domainScopeGrid,
  currentTerm,
  actionError,
}: {
  project: LoaderData["project"];
  teams: LoaderData["teams"];
  documents: LoaderData["documents"];
  files: LoaderData["files"];
  allTags: LoaderData["allTags"];
  canEdit: boolean;
  domainScopeGrid: LoaderData["domainScopeGrid"];
  currentTerm: LoaderData["currentTerm"];
  actionError?: string;
}) {
  // The current term's per-domain challenge, read-only on Overview. Edited in
  // the Scope settings popup. Only non-empty cells for the current term show.
  const currentChallenges = currentTerm
    ? domainScopeGrid.filter(
        (c) => c.termId === currentTerm.id && c.scope.trim() !== "",
      )
    : [];

  return (
    <div className="flex flex-col gap-4">
      {actionError && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionError}
        </div>
      )}

      {/* Description — its own segment on top, separate from Project details */}
      <DescriptionSegment description={project.description} canEdit={canEdit} />

      {/* Challenge for the current term, per declared domain (read-only). */}
      {currentTerm && currentChallenges.length > 0 && (
        <section className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">
            Challenge{" "}
            <span className="text-xs font-normal text-muted-foreground">
              · {currentTerm.code}
            </span>
          </h3>
          <div className="space-y-3">
            {currentChallenges.map((c) => (
              <div key={c.domainId}>
                <div className="text-xs font-medium text-muted-foreground">
                  {c.domainName}
                </div>
                <p className="text-sm text-foreground whitespace-pre-wrap mt-0.5">
                  {c.scope}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Project details. Editable as one section; commits via intent=details
          which expects the full field set. Section-level Save submits and
          closes; Cancel reverts (the wrapper remounts the body which resets
          defaultValue inputs). */}
      <DetailsSegment project={project} canEdit={canEdit} />

      {/* Team — read-only summary, separate from the editable details. */}
      <section className="bg-card border border-border rounded-lg p-4">
        <TeamSection teams={teams} />
      </section>

      {/* Documents — collab-doc pages; rows + Add open the doc as a split-screen
          tab beside the project (via the TabWorkspace shell). */}
      <DocumentsBlock
        projectId={project.id}
        documents={documents}
        allTags={allTags}
        canEdit={canEdit}
      />

      {/* Files — standalone uploads with versions + tags. */}
      <FilesBlock
        projectId={project.id}
        files={files}
        allTags={allTags}
        canEdit={canEdit}
      />
    </div>
  );
}

function ScopeTab({
  project,
  allDomainOptions,
  plannedTerms,
  allTermOptions,
  domainScopeGrid,
  canEdit,
  actionError,
}: {
  project: LoaderData["project"];
  allDomainOptions: LoaderData["allDomainOptions"];
  plannedTerms: LoaderData["plannedTerms"];
  allTermOptions: LoaderData["allTermOptions"];
  domainScopeGrid: LoaderData["domainScopeGrid"];
  canEdit: boolean;
  actionError?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {actionError && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionError}
        </div>
      )}

      {/* Declared domains — editable; if none declared the derived set from
          assignments + bids is shown as a fallback so a freshly-created
          project that's mid-staffing still has visible domain context. */}
      <DomainsSegment
        declared={project.domains}
        derived={project.derivedDomains}
        allDomains={allDomainOptions}
        canEdit={canEdit}
      />

      {/* Project terms — the editable term set. Start term and active-this-term
          are derived from this set; termCount (Details) is the expected target. */}
      <TermsSegment
        selected={plannedTerms}
        allTerms={allTermOptions}
        expected={project.termCount}
        canEdit={canEdit}
      />

      {/* Per-domain, per-term scope grid. One cell per (declared domain ×
          planned term). Empty cell = no scope written yet. Auto-saves on
          blur; clearing a cell to empty deletes the row. */}
      {project.domains.length > 0 && plannedTerms.length > 0 && (
        <DomainScopesSegment
          domains={project.domains}
          terms={plannedTerms}
          grid={domainScopeGrid}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}

function DocumentsBlock({
  projectId,
  documents,
  allTags,
  canEdit,
}: {
  projectId: string;
  documents: LoaderData["documents"];
  allTags: LoaderData["allTags"];
  canEdit: boolean;
}) {
  const revalidator = useRevalidator();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Add document: create an "Untitled" page immediately, then open it as a
  // split-screen tab beside the project. The title is renamed inline in the
  // editor (auto-saves), so there's no separate title prompt first.
  async function createDocument() {
    setBusy(true);
    setError(null);
    try {
      const title = "Untitled";
      const res = await fetch(`/api/projects/${projectId}/documents`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const b = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !b.id) throw new Error(b.error ?? "Failed to create document");
      openDocumentTab(b.id, title);
      revalidator.revalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function deleteDocument(id: string, title: string) {
    if (!window.confirm(`Delete document "${title}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Failed to delete");
      }
      revalidator.revalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground">Documents</h2>
        {canEdit && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void createDocument()}
            className="text-xs font-medium text-accent-coral hover:underline disabled:opacity-60"
          >
            {busy ? "Adding…" : "+ Add document"}
          </button>
        )}
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-xs rounded-md px-3 py-2 mb-3">
          {error}
        </div>
      )}

      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No documents yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {documents.map((doc) => (
            <div key={doc.id} className="py-2.5 flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <button
                  type="button"
                  onClick={() => openDocumentTab(doc.id, doc.title)}
                  className="truncate text-left font-medium text-foreground hover:text-accent-coral"
                >
                  {doc.title}
                </button>
                {canEdit && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void deleteDocument(doc.id, doc.title)}
                    className="text-xs text-destructive hover:underline disabled:opacity-60 flex-shrink-0"
                  >
                    Delete
                  </button>
                )}
              </div>
              <TagPicker
                targetType="doc"
                targetId={doc.id}
                applied={doc.tags}
                allTags={allTags}
                canEdit={canEdit}
                canCreate={canEdit}
                onChange={() => revalidator.revalidate()}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function FilesBlock({
  projectId,
  files,
  allTags,
  canEdit,
}: {
  projectId: string;
  files: LoaderData["files"];
  allTags: LoaderData["allTags"];
  canEdit: boolean;
}) {
  const revalidator = useRevalidator();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // When set, the chosen file is added as a new version of this file id;
  // otherwise it creates a new ProjectFile.
  const versionForId = useRef<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    const targetId = versionForId.current;
    versionForId.current = null;

    setBusy(true);
    setError(null);
    try {
      const meta = await uploadFileToS3(picked, `project-files/${projectId}`);
      if (targetId) {
        const res = await fetch(`/api/files/${targetId}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intent: "version", ...meta }),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(b.error ?? "Failed to upload new version");
        }
      } else {
        const res = await fetch(`/api/projects/${projectId}/files`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: picked.name, ...meta }),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(b.error ?? "Failed to add file");
        }
      }
      revalidator.revalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteFile(id: string, title: string) {
    if (!window.confirm(`Delete file "${title}"? All versions will be removed.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/files/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Failed to delete");
      }
      revalidator.revalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <input ref={fileInputRef} type="file" className="hidden" onChange={onPick} />
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground">Files</h2>
        {canEdit && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              versionForId.current = null;
              fileInputRef.current?.click();
            }}
            className="text-xs font-medium text-accent-coral hover:underline disabled:opacity-60"
          >
            {busy ? "Uploading…" : "+ Add file"}
          </button>
        )}
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-xs rounded-md px-3 py-2 mb-3">
          {error}
        </div>
      )}

      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No files yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {files.map((f) => (
            <div key={f.id} className="py-2.5 flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <Link to={`/documents/file/${f.id}`} className="min-w-0 truncate hover:text-accent-coral">
                  <span className="text-foreground font-medium">{f.title}</span>
                  <span className="text-muted-foreground ml-2 text-xs">
                    {f.fileName}
                    {f.sizeBytes != null ? ` · ${formatBytes(f.sizeBytes)}` : ""}
                    {f.versionCount > 1 ? ` · v${f.versionCount}` : ""}
                  </span>
                </Link>
                {canEdit && (
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        versionForId.current = f.id;
                        fileInputRef.current?.click();
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
                    >
                      New version
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void deleteFile(f.id, f.title)}
                      className="text-xs text-destructive hover:underline disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
              <TagPicker
                targetType="file"
                targetId={f.id}
                applied={f.tags}
                allTags={allTags}
                canEdit={canEdit}
                canCreate={canEdit}
                onChange={() => revalidator.revalidate()}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function WorkTab({
  projectId,
  epics,
  editableEpics,
  sprints,
  tasks,
  boardOptions,
  canEdit,
  collabToken,
  userName,
}: {
  projectId: string;
  epics: TimelineEpic[];
  editableEpics: EditableEpic[];
  sprints: EditableSprint[];
  tasks: TaskCardModel[];
  boardOptions: TaskBoardOptions;
  canEdit: boolean;
  collabToken: string | null;
  userName: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-sm font-semibold text-foreground mb-3">Epics &amp; sprints</h2>
        <EpicSprintManager
          projectId={projectId}
          timelineEpics={epics}
          epics={editableEpics}
          sprints={sprints}
          canManage={canEdit}
          collabToken={collabToken}
          userName={userName}
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-foreground mb-3">Task board</h2>
        <TaskBoard
          projectId={projectId}
          initialTasks={tasks}
          options={boardOptions}
          canManage={canEdit}
        />
      </section>
    </div>
  );
}

