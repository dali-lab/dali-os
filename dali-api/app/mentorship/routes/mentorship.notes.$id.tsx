import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/mentorship.notes.$id";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db.server";
import { recordRouteVisit } from "~/lib/user-pages.server";
import { getPageAccess } from "~/lib/pageAccess.server";
import { getCollabToken } from "~/lib/collab-token.server";
import { canViewMentorship, canViewMentorNote } from "../lib/visibility";
import { ensureMentorNotePage } from "../lib/pair-notebook.server";
import { readMentorNoteBlocks } from "../lib/note-body.server";
import { weekNumberInTerm } from "../lib/week";
import { BackLink } from "../components/BackLink";
import { MentorNoteView, type MentorNoteData } from "../components/MentorNoteView";

function fullName(u: { firstName: string; lastName: string }) {
  return `${u.firstName} ${u.lastName}`.trim();
}

export const meta: Route.MetaFunction = () => [
  { title: "Mentor note · DALI OS" },
];

export const handle = {
  docKey: "mentorship.notes",
  docTitle: "Mentorship notes",
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  if (!(await canViewMentorship(auth.user.sub))) {
    throw new Response("Forbidden", { status: 403 });
  }

  const note = await prisma.mentorNote.findUnique({
    where: { id: params.id! },
    select: {
      id: true,
      mentorId: true,
      menteeId: true,
      projectId: true,
      termId: true,
      domainId: true,
      weekOf: true,
      contentJson: true,
      pageId: true,
      vibe: true,
      mentor: { select: { id: true, firstName: true, lastName: true } },
      mentee: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
    },
  });
  if (!note) throw new Response("Not found", { status: 404 });
  if (!(await canViewMentorNote(auth.user.sub, note))) {
    throw new Response("Forbidden", { status: 403 });
  }

  const { pageId } = await ensureMentorNotePage(note, auth.user.sub);
  const access = await getPageAccess(auth.user.sub, pageId);
  if (!access.canView) throw new Response("Forbidden", { status: 403 });

  // After the visibility gate — the note the viewer can open lands in recents.
  recordRouteVisit(
    auth.user.sub,
    `/mentorship/notes/${note.id}`,
    `${fullName(note.mentee)} — mentor note`,
    request,
  );

  const [project, term, domain, me] = await Promise.all([
    prisma.project.findUnique({
      where: { id: note.projectId },
      select: { name: true },
    }),
    prisma.term.findUnique({
      where: { id: note.termId },
      select: { code: true, startDate: true },
    }),
    prisma.domain.findUnique({
      where: { id: note.domainId },
      select: { displayName: true },
    }),
    prisma.user.findUnique({
      where: { id: auth.user.sub },
      select: { firstName: true, lastName: true },
    }),
  ]);

  const data: MentorNoteData = {
    id: note.id,
    pageId,
    weekOfIso: note.weekOf.toISOString(),
    weekNumber: term ? weekNumberInTerm(note.weekOf, term.startDate) : null,
    contentJson: await readMentorNoteBlocks({ pageId, contentJson: note.contentJson }),
    vibe: note.vibe,
    mentor: note.mentor,
    mentee: note.mentee,
    projectName: project?.name ?? "Unknown",
    termCode: term?.code ?? "?",
    domainDisplay: domain?.displayName ?? "Unknown",
    canEdit: access.canEdit,
    collabToken: await getCollabToken(request),
    userName: [me?.firstName, me?.lastName].filter(Boolean).join(" ") || "Mentor",
  };
  return data;
}

export default function MentorNoteEditor() {
  const data = useLoaderData() as MentorNoteData;
  return (
    <main className="flex w-full min-w-0 flex-col gap-4">
      <BackLink to="/mentorship/browse">Back to Mentorship Notes</BackLink>
      <MentorNoteView data={data} />
    </main>
  );
}
