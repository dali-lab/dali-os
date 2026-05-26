import type { Route } from "./+types/api.domain-applications.$id.full-context";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { hasCycleAccess } from "~/lib/roles";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";
import { buildCriteriaLabelMap } from "~/hiring/lib/rubric-criteria";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const da = await prisma.domainApplication.findUnique({
    where: { id: params.id },
    include: {
      challengeVersion: {
        select: {
          questions: true,
          domain: { select: { id: true, name: true } },
        },
      },
      domain: { select: { id: true, name: true } },
      application: {
        include: {
          user: { select: { firstName: true, lastName: true } },
          generalChallengeVersion: { select: { questions: true } },
          internToFullFormVersion: { select: { questions: true } },
          applicationCycle: { select: { id: true, generalRubricVersionId: true, cycleType: true } },
        },
      },
      reviews: {
        orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
        include: {
          cycleReviewer: {
            include: {
              user: { select: { firstName: true, lastName: true } },
            },
          },
        },
      },
      decisions: {
        orderBy: { createdAt: "desc" },
        include: { madeBy: { select: { firstName: true, lastName: true } } },
      },
      interviews: {
        where: { status: { in: ["Scheduled", "Completed"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          assignments: {
            where: { status: "Active" },
            include: {
              cycleInterviewer: {
                include: { user: { select: { firstName: true, lastName: true } } },
              },
            },
          },
        },
      },
    },
  });

  if (!da) return Response.json({ error: "Not found" }, { status: 404 });
  if (!(await hasCycleAccess(auth.user.sub, da.application.applicationCycleId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const gate = await requireApiSignedOrForbidden(
    auth.user.sub,
    da.application.applicationCycleId,
  );
  if (gate) return gate;

  const domainId = da.challengeVersion?.domain?.id ?? da.domainId ?? null;
  const [domainCycle, generalRubric] = await Promise.all([
    domainId
      ? prisma.domainApplicationCycle.findUnique({
          where: {
            domainId_applicationCycleId: {
              domainId,
              applicationCycleId: da.application.applicationCycleId,
            },
          },
          select: { rubricVersionId: true },
        })
      : Promise.resolve(null),
    da.application.applicationCycle.generalRubricVersionId
      ? prisma.rubricVersion.findUnique({
          where: { id: da.application.applicationCycle.generalRubricVersionId },
          select: { criteria: true },
        })
      : Promise.resolve(null),
  ]);

  // Criterion key -> label map resilient to rubric edits (prefers the current
  // rubric, falls back to each review's pinned version + rubric history).
  const criteriaByKey = await buildCriteriaLabelMap({
    domainRubricVersionId: domainCycle?.rubricVersionId ?? null,
    generalCriteria: generalRubric?.criteria,
    pinnedVersionIds: da.reviews.map((r) => r.rubricVersionId),
  });

  // Interview notes live in CollabDocumentVersion (Yjs/Tiptap), keyed by doc
  // name — mirror the domain-lead applicant-detail view:
  //   interview:{id}:notes                     — joint, shared by interviewers
  //   interview:{id}:rec-notes-{assignmentId}  — per-interviewer rec notes
  const collabDocNames: string[] = [];
  for (const iv of da.interviews) {
    collabDocNames.push(`interview:${iv.id}:notes`);
    for (const a of iv.assignments) {
      collabDocNames.push(`interview:${iv.id}:rec-notes-${a.id}`);
    }
  }
  const collabVersionRows = collabDocNames.length > 0
    ? await prisma.collabDocumentVersion.findMany({
        where: { name: { in: collabDocNames } },
        orderBy: { createdAt: "desc" },
        select: { name: true, plainText: true },
      })
    : [];
  const latestCollabByName = new Map<string, string>();
  for (const row of collabVersionRows) {
    if (!latestCollabByName.has(row.name)) {
      latestCollabByName.set(row.name, row.plainText);
    }
  }
  const interviews = da.interviews.map((iv) => ({
    ...iv,
    jointNotes: latestCollabByName.get(`interview:${iv.id}:notes`)?.trim() || null,
    assignments: iv.assignments.map((a) => ({
      ...a,
      recNotes:
        latestCollabByName.get(`interview:${iv.id}:rec-notes-${a.id}`)?.trim() || null,
    })),
  }));

  return Response.json({
      domainApplication: {
        id: da.id,
        answers: da.answers,
        domain: da.challengeVersion?.domain ?? da.domain ?? null,
        challengeQuestions: da.challengeVersion?.questions ?? [],
        interviewPrepNote: da.interviewPrepNote,
      },
      application: {
        id: da.application.id,
        answers: da.application.answers,
        generalQuestions:
          da.application.applicationCycle.cycleType === "InternToFull"
            ? da.application.internToFullFormVersion?.questions ?? []
            : da.application.generalChallengeVersion?.questions ?? [],
        applicant: da.application.user,
      },
      reviews: da.reviews,
      decisions: da.decisions,
      interviews,
      criteriaByKey,
    });
}
