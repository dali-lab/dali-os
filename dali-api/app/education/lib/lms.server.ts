// Course-hub reads: the enrolled-student (and manager-preview) view of an
// offering. Materials are EducationOffering-workspace Pages; students get
// server-rendered read-only content (no Hocuspocus exposure), managers get
// /documents/:pageId links to the live editor.

import { prisma } from "~/lib/db";
import { resolvePhotoUrl } from "~/lib/photo";
import { collabDocToProseMirror, collabDocToHtml } from "~/collab/export";
import { listDiscussion } from "./announcements.server";
import { listAssignments } from "./assignments.server";
import { listThreads, offeringInstructorIds } from "./discussions.server";
import { studentVisibleFeedback } from "./student-notes.server";

export async function listMaterialPages(offeringId: string) {
  const pages = await prisma.page.findMany({
    where: {
      workspaceType: "EducationOffering",
      workspaceId: offeringId,
      archivedAt: null,
      // Collaborative "workspace" docs live in their own hub tab, not Materials.
      studentEditable: false,
    },
    orderBy: [{ position: "asc" }],
    select: { id: true, title: true, kind: true, parentPageId: true, updatedAt: true },
  });
  // 2-level tree, top-level pages first with their children inline after.
  const topLevel = pages.filter((p) => p.parentPageId === null);
  const childrenByParent = new Map<string, typeof pages>();
  for (const p of pages) {
    if (!p.parentPageId) continue;
    const list = childrenByParent.get(p.parentPageId) ?? [];
    list.push(p);
    childrenByParent.set(p.parentPageId, list);
  }
  return topLevel.map((p) => ({
    id: p.id,
    title: p.title,
    isFolder: p.kind === "Folder",
    updatedAt: p.updatedAt,
    children: (childrenByParent.get(p.id) ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt,
    })),
  }));
}

/**
 * Collaborative "workspace" docs for an offering — pages marked studentEditable
 * that enrolled students co-edit live (a shared scratchpad / group doc), shown
 * in the hub's Workspace tab. Flat list (no nesting) in v1.
 */
export async function listWorkspaceDocs(offeringId: string) {
  return prisma.page.findMany({
    where: {
      workspaceType: "EducationOffering",
      workspaceId: offeringId,
      archivedAt: null,
      studentEditable: true,
    },
    orderBy: [{ position: "asc" }],
    select: { id: true, title: true },
  });
}

/**
 * A material page rendered server-side for read-only viewing. Returns null
 * when the page doesn't exist, is archived, or belongs to another workspace
 * (the offering scope IS the permission check — callers gate enrollment).
 */
export async function readMaterialPage(offeringId: string, pageId: string) {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      id: true,
      title: true,
      workspaceType: true,
      workspaceId: true,
      archivedAt: true,
    },
  });
  if (
    !page ||
    page.archivedAt !== null ||
    page.workspaceType !== "EducationOffering" ||
    page.workspaceId !== offeringId
  ) {
    return null;
  }
  const content = await collabDocToProseMirror(`doc:${page.id}:body`);
  return { id: page.id, title: page.title, content };
}

/** Create a material page in the offering workspace (manager-gated at route). */
export async function createMaterialPage(args: {
  offeringId: string;
  title: string;
  parentPageId?: string | null;
  // A shared collaborative "workspace" doc enrolled students can co-edit
  // (Workspace tab) vs a read-only material page (default).
  studentEditable?: boolean;
  /** A Folder groups materials and is never opened as a document itself. */
  kind?: "FreeForm" | "Folder";
  actorId: string;
}): Promise<{ id: string } | { error: string; status: number }> {
  const title = args.title.trim();
  if (!title) return { error: "Title is required", status: 400 };

  // Nothing nests inside a folder except materials, and a folder is always
  // top-level — otherwise "folder" stops meaning anything.
  if (args.kind === "Folder" && args.parentPageId) {
    return { error: "Folders can't be nested", status: 400 };
  }

  if (args.parentPageId) {
    const parent = await prisma.page.findUnique({
      where: { id: args.parentPageId },
      select: { workspaceType: true, workspaceId: true, parentPageId: true },
    });
    if (
      !parent ||
      parent.workspaceType !== "EducationOffering" ||
      parent.workspaceId !== args.offeringId
    ) {
      return { error: "Parent page not found", status: 404 };
    }
    // 2-level tree: children can't have children.
    if (parent.parentPageId !== null) {
      return { error: "Pages only nest one level deep", status: 400 };
    }
  }

  const last = await prisma.page.findFirst({
    where: {
      workspaceType: "EducationOffering",
      workspaceId: args.offeringId,
      parentPageId: args.parentPageId ?? null,
    },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const page = await prisma.page.create({
    data: {
      workspaceType: "EducationOffering",
      workspaceId: args.offeringId,
      title,
      kind: args.kind ?? "FreeForm",
      parentPageId: args.parentPageId ?? null,
      position: (last?.position ?? -1) + 1,
      studentEditable: args.studentEditable ?? false,
      createdById: args.actorId,
    },
    select: { id: true },
  });
  return page;
}

/**
 * Move a material into a folder, or back to the top level. Only materials
 * move: a folder is always top-level, and nothing nests inside a material.
 */
export async function moveMaterialPage(args: {
  offeringId: string;
  pageId: string;
  parentPageId: string | null;
  actorId: string;
}): Promise<{ ok: true } | { error: string; status: number }> {
  const page = await prisma.page.findUnique({
    where: { id: args.pageId },
    select: { workspaceType: true, workspaceId: true, kind: true },
  });
  if (
    !page ||
    page.workspaceType !== "EducationOffering" ||
    page.workspaceId !== args.offeringId
  ) {
    return { error: "Page not found", status: 404 };
  }
  if (page.kind === "Folder") return { error: "Folders stay at the top level", status: 400 };

  if (args.parentPageId) {
    const parent = await prisma.page.findUnique({
      where: { id: args.parentPageId },
      select: { workspaceType: true, workspaceId: true, kind: true },
    });
    if (
      !parent ||
      parent.workspaceType !== "EducationOffering" ||
      parent.workspaceId !== args.offeringId
    ) {
      return { error: "Folder not found", status: 404 };
    }
    if (parent.kind !== "Folder") return { error: "Materials only nest in folders", status: 400 };
  }

  await prisma.page.update({
    where: { id: args.pageId },
    data: { parentPageId: args.parentPageId },
  });
  return { ok: true };
}

/** Session list for the hub — includes the caller's own attendance marks. */
export async function listSessionsWithMyAttendance(
  offeringId: string,
  applicationId: string | null,
) {
  const sessions = await prisma.educationSession.findMany({
    where: { offeringId },
    orderBy: { sequence: "asc" },
    select: {
      id: true,
      sequence: true,
      title: true,
      datetime: true,
      location: true,
      recordingUrl: true,
    },
  });
  if (!applicationId) return sessions.map((s) => ({ ...s, myAttendance: null }));
  const marks = await prisma.educationAttendance.findMany({
    where: { applicationId },
    select: { sessionId: true, status: true },
  });
  const bySession = new Map(marks.map((m) => [m.sessionId, m.status]));
  return sessions.map((s) => ({
    ...s,
    myAttendance: bySession.get(s.id) ?? null,
  }));
}

/**
 * Everything the course hub renders, assembled server-side so the member and
 * portal hub loaders stay thin. Callers gate access (requireEnrollment)
 * before calling.
 */
export async function getHubData(args: {
  offeringId: string;
  userId: string;
  applicationId: string | null;
  isManager: boolean;
}) {
  const offering = await prisma.educationOffering.findUnique({
    where: { id: args.offeringId },
    select: { id: true, title: true, descriptionDocId: true },
  });
  if (!offering) return null;

  const instructorIds = await offeringInstructorIds(args.offeringId);

  // Who's teaching, and who else is in the room. A student had no way to see
  // either from inside the hub.
  const [instructors, classmates] = await Promise.all([
    prisma.instructorAssignment.findMany({
      where: { offeringId: args.offeringId },
      select: {
        user: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
      },
    }),
    prisma.educationApplication.findMany({
      where: { offeringId: args.offeringId, status: "Approved" },
      orderBy: { submittedAt: "asc" },
      select: {
        applicant: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
      },
    }),
  ]);

  const [
    descriptionHtml,
    announcements,
    sessions,
    materials,
    workspaceDocs,
    assignments,
    threads,
    mySubmissions,
    myFeedback,
    me,
  ] = await Promise.all([
    offering.descriptionDocId
      ? collabDocToHtml(offering.descriptionDocId)
      : Promise.resolve(""),
    listDiscussion(args.offeringId),
    listSessionsWithMyAttendance(args.offeringId, args.applicationId),
    listMaterialPages(args.offeringId),
    listWorkspaceDocs(args.offeringId),
    listAssignments(args.offeringId),
    listThreads(args.offeringId, instructorIds),
    prisma.educationSubmission.findMany({
      where: { studentId: args.userId },
      select: { assignmentId: true, submittedAt: true },
    }),
    // Student-visible lane only — the safe reader by construction.
    args.applicationId
      ? studentVisibleFeedback(args.applicationId)
      : Promise.resolve(null),
    prisma.user.findUnique({
      where: { id: args.userId },
      select: { firstName: true, lastName: true },
    }),
  ]);

  const myCertificate = args.applicationId
    ? await prisma.educationCertificate.findUnique({
        where: { applicationId: args.applicationId },
        select: { id: true },
      })
    : null;

  const submittedByAssignment = new Map(
    mySubmissions.map((s) => [s.assignmentId, s.submittedAt]),
  );

  return {
    offering: {
      id: offering.id,
      title: offering.title,
      descriptionHtml,
    },
    instructors: await Promise.all(
      instructors.map(async (i) => ({
        id: i.user.id,
        name: `${i.user.firstName} ${i.user.lastName}`.trim(),
        photoUrl: await resolvePhotoUrl(i.user.photoUrl),
      })),
    ),
    classmates: await Promise.all(
      classmates.map(async (c) => ({
        id: c.applicant.id,
        name: `${c.applicant.firstName} ${c.applicant.lastName}`.trim(),
        photoUrl: await resolvePhotoUrl(c.applicant.photoUrl),
        isMe: c.applicant.id === args.userId,
      })),
    ),
    // Passed through whole: the discussion component renders authors, replies
    // and the announcement/message distinction itself.
    announcements,
    sessions,
    materials,
    workspaceDocs,
    assignments: assignments.map((a) => ({
      id: a.id,
      title: a.title,
      dueAt: a.dueAt,
      sessionSequence: a.sessionSequence,
      mySubmittedAt: submittedByAssignment.get(a.id) ?? null,
    })),
    threads,
    myFeedback,
    myCertificateId: myCertificate?.id ?? null,
    isManager: args.isManager,
    currentUserId: args.userId,
    currentUserName: me ? `${me.firstName} ${me.lastName}`.trim() : "Student",
  };
}
