import { prisma } from "~/lib/db";
import { DRIVE_SPACES } from "~/lib/drive-spaces";
import { findReceiver, projectSlot, singletonSlot } from "~/lib/drive-receivers.server";
import { formatFiledPath, notebookLocationParts } from "~/lib/note-path.server";
import { getPageAccessBulk, PAGE_ACCESS_SELECT } from "~/lib/pageAccess.server";
import { pairNotebookKey } from "~/mentorship/lib/pair-notebook.server";
import { findMentorPair } from "~/mentorship/lib/pair-suggestion.server";

export type DefaultNotebookKind = "series" | "history" | "pair" | "new";

export type DefaultNotebook = {
  kind: DefaultNotebookKind;
  notebook: { id: string; title: string; path: string } | null;
  newPath: string;
};

export type DefaultNotebookInput = {
  actorId: string;
  meetingId?: string | null;
  scopeType: "Group" | "UserList" | "None";
  groupId?: string | null;
  projectId?: string | null;
  isCoreMeeting?: boolean;
  /** The one other person on a 1:1 invite: their mentor-to-mentee pair notebook is the default when it already exists. */
  pairMenteeId?: string | null;
  request?: Request;
};

const HISTORY_SCAN = 20;

const liveNotebook = { kind: "Notebook", archivedAt: null } as const;
const notebookSelect = { ...PAGE_ACCESS_SELECT, title: true } as const;

type NotebookRow = Awaited<ReturnType<typeof loadSeries>>;

async function loadSeries(meetingId: string) {
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: meetingId },
    select: { notebook: { select: { ...notebookSelect, kind: true, archivedAt: true } } },
  });
  const nb = meeting?.notebook;
  return nb && nb.kind === "Notebook" && nb.archivedAt === null ? nb : null;
}

async function viewable<T extends NonNullable<NotebookRow>>(rows: T[], actorId: string, request?: Request) {
  const access = await getPageAccessBulk(actorId, rows, request);
  return rows.filter((r) => access.get(r.id)?.canView);
}

async function describe(row: NonNullable<NotebookRow>, actorId: string, request?: Request) {
  const parts = await notebookLocationParts(row, actorId, request);
  return { id: row.id, title: row.title, path: formatFiledPath(parts) };
}

/** Where a new notebook for this space would land. Reads only: a receiver that
 *  does not exist yet is not created for a preview, so the path stops at the space. */
export async function newNotebookPath(
  input: Pick<DefaultNotebookInput, "actorId" | "projectId" | "isCoreMeeting" | "request">,
): Promise<string> {
  const { actorId, projectId, request } = input;
  const space = projectId
    ? { slot: projectSlot(projectId), workspaceType: "Project", workspaceId: projectId }
    : { slot: singletonSlot(input.isCoreMeeting ? "Core" : "Lab", "Meetings"), workspaceType: "Lab", workspaceId: null };
  const receiverId = await findReceiver(space.slot);
  if (receiverId) {
    return formatFiledPath(
      await notebookLocationParts(
        { parentPageId: receiverId, workspaceType: space.workspaceType, workspaceId: space.workspaceId },
        actorId,
        request,
      ),
    );
  }
  if (!projectId && input.isCoreMeeting) return DRIVE_SPACES.find((s) => s.key === "core")?.label ?? "Core";
  return formatFiledPath(
    await notebookLocationParts(
      { parentPageId: null, workspaceType: space.workspaceType, workspaceId: space.workspaceId },
      actorId,
      request,
    ),
  );
}

/**
 * The notebook a meeting form should start on: the series' own, else the one
 * the same group used last, else a mentor's pair notebook for a 1:1 with their
 * mentee, else a new one.
 */
export async function resolveDefaultNotebook(input: DefaultNotebookInput): Promise<DefaultNotebook> {
  const { actorId, request } = input;
  const newPath = () => newNotebookPath(input);

  if (input.meetingId) {
    const series = await loadSeries(input.meetingId);
    if (series && (await viewable([series], actorId, request)).length > 0) {
      return { kind: "series", notebook: await describe(series, actorId, request), newPath: await newPath() };
    }
  }

  // Only a single-group invite stores its group, so a UserList invite has no
  // history. The spec keyed history on the set of invited groups; this is the
  // deliberate first cut until that key is stored.
  if (input.scopeType === "Group" && input.groupId) {
    const recent = await prisma.scheduledMeeting.findMany({
      where: {
        scopeType: "Group",
        scopeId: input.groupId,
        status: { not: "Cancelled" },
        notebook: { is: liveNotebook },
      },
      orderBy: [{ selectedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: HISTORY_SCAN,
      select: { notebook: { select: { ...notebookSelect, kind: true, archivedAt: true } } },
    });
    const rows = recent.flatMap((m) => (m.notebook ? [m.notebook] : []));
    const seen = new Set((await viewable(rows, actorId, request)).map((r) => r.id));
    const pick = rows.find((r) => seen.has(r.id));
    if (pick) {
      return { kind: "history", notebook: await describe(pick, actorId, request), newPath: await newPath() };
    }
  }

  if (input.pairMenteeId) {
    const pair = await findMentorPair(actorId, input.pairMenteeId, request);
    const existing = pair
      ? await prisma.page.findUnique({
          where: { notebookKey: pairNotebookKey(pair) },
          select: { ...notebookSelect, kind: true, archivedAt: true },
        })
      : null;
    if (existing && existing.kind === "Notebook" && existing.archivedAt === null) {
      if ((await viewable([existing], actorId, request)).length > 0) {
        return { kind: "pair", notebook: await describe(existing, actorId, request), newPath: await newPath() };
      }
    }
  }

  return { kind: "new", notebook: null, newPath: await newPath() };
}
