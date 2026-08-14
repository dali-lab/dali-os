// MCP `get_application` — full context for one domain application.
// Reuses the query from api.domain-applications.$id.full-context.ts exactly,
// including the confidentiality gate: the caller must have signed the cycle's
// confidentiality agreement.
//
// Access:
//   hasCycleAccess (Core, domain lead, reviewer, or interviewer for this cycle)
//   + signed confidentiality agreement for the cycle.

import { prisma } from "~/lib/db";
import { hasCycleAccess } from "~/lib/roles";
import { getCycleConfidentialityState } from "~/hiring/lib/confidentiality";
import { buildCriteriaLabelMap } from "~/hiring/lib/rubric-criteria";
import { McpNotFoundError, McpForbiddenError } from "../../registry";

export const GET_APPLICATION_TOOL = {
  name: "get_application",
  description:
    "Get the full context for a domain application: answers, reviews, decisions, interviews, and rubric criteria. Requires cycle access and a signed confidentiality agreement for the cycle.",
  inputSchema: {
    type: "object" as const,
    properties: {
      domainApplicationId: {
        type: "string",
        minLength: 1,
        description: "DomainApplication.id, as returned by `list_applications`.",
      },
    },
    required: ["domainApplicationId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { domainApplicationId: string };

export async function runGetApplication(userId: string, input: Input): Promise<unknown> {
  const da = await prisma.domainApplication.findUnique({
    where: { id: input.domainApplicationId },
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
          shortformVersion: { select: { questions: true } },
          applicationCycle: {
            select: { id: true, generalRubricVersionId: true, cycleType: true },
          },
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
                include: {
                  user: { select: { firstName: true, lastName: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!da) throw new McpNotFoundError("Domain application not found");

  const cycleId = da.application.applicationCycleId;

  if (!(await hasCycleAccess(userId, cycleId))) {
    throw new McpForbiddenError("No access to this cycle");
  }

  // Confidentiality gate: caller must have signed the agreement.
  const confState = await getCycleConfidentialityState(userId, cycleId);
  if (confState.status !== "signed") {
    throw new McpForbiddenError(
      `Confidentiality agreement required (${confState.status}). Sign it in the web app first.`,
    );
  }

  const domainId = da.challengeVersion?.domain?.id ?? da.domainId ?? null;
  const [domainCycle, generalRubric] = await Promise.all([
    domainId
      ? prisma.domainApplicationCycle.findUnique({
          where: {
            domainId_applicationCycleId: {
              domainId,
              applicationCycleId: cycleId,
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

  const criteriaByKey = await buildCriteriaLabelMap({
    domainRubricVersionId: domainCycle?.rubricVersionId ?? null,
    generalCriteria: generalRubric?.criteria,
    pinnedVersionIds: da.reviews.map((r) => r.rubricVersionId),
  });

  // Interview notes from CollabDocumentVersion (same as full-context route).
  const collabDocNames: string[] = [];
  for (const iv of da.interviews) {
    collabDocNames.push(`interview:${iv.id}:notes`);
    for (const a of iv.assignments) {
      collabDocNames.push(`interview:${iv.id}:rec-notes-${a.id}`);
    }
  }
  const collabVersionRows =
    collabDocNames.length > 0
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
    id: iv.id,
    status: iv.status,
    startTime: iv.startTime.toISOString(),
    endTime: iv.endTime.toISOString(),
    location: iv.location,
    jointNotes: latestCollabByName.get(`interview:${iv.id}:notes`)?.trim() || null,
    assignments: iv.assignments.map((a) => ({
      id: a.id,
      interviewer: a.cycleInterviewer.user,
      recNotes:
        latestCollabByName.get(`interview:${iv.id}:rec-notes-${a.id}`)?.trim() || null,
    })),
  }));

  return {
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
        da.application.applicationCycle.cycleType === "Fellowship"
          ? da.application.shortformVersion?.questions ?? []
          : da.application.generalChallengeVersion?.questions ?? [],
      applicant: da.application.user,
    },
    reviews: da.reviews,
    decisions: da.decisions,
    interviews,
    criteriaByKey,
  };
}
