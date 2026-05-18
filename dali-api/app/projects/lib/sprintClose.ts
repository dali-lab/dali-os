import { prisma } from "~/lib/db";

// Sprint close logic. Extracted from the route action so it can be unit-tested
// and reused by future bulk operations (e.g. closing all overdue sprints).

export type OpenTaskDestination = "backlog" | "nextSprint";

export interface CloseSprintResult {
  sprintId: string;
  movedTaskCount: number;
  destination: OpenTaskDestination;
  destinationSprintId: string | null;
}

export class SprintCloseError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "already_closed"
      | "no_next_sprint",
  ) {
    super(message);
    this.name = "SprintCloseError";
  }
}

const OPEN_STATUSES = ["Todo", "InProgress", "InReview"] as const;

export async function closeSprint(
  sprintId: string,
  destination: OpenTaskDestination,
): Promise<CloseSprintResult> {
  return prisma.$transaction(async (tx) => {
    const sprint = await tx.sprint.findUnique({ where: { id: sprintId } });
    if (!sprint) {
      throw new SprintCloseError(`Sprint ${sprintId} not found`, "not_found");
    }
    if (sprint.status === "Closed") {
      throw new SprintCloseError("Sprint already closed", "already_closed");
    }

    let destinationSprintId: string | null = null;
    if (destination === "nextSprint") {
      const next = await tx.sprint.findFirst({
        where: {
          projectId: sprint.projectId,
          status: { in: ["Planned", "Active"] },
          id: { not: sprint.id },
        },
        orderBy: { startsAt: "asc" },
      });
      if (!next) {
        throw new SprintCloseError(
          "No other Planned or Active sprint to move open tasks into",
          "no_next_sprint",
        );
      }
      destinationSprintId = next.id;
    }

    const moveResult = await tx.task.updateMany({
      where: {
        sprintId: sprint.id,
        status: { in: [...OPEN_STATUSES] },
      },
      data: { sprintId: destinationSprintId },
    });

    await tx.sprint.update({
      where: { id: sprint.id },
      data: { status: "Closed" },
    });

    return {
      sprintId: sprint.id,
      movedTaskCount: moveResult.count,
      destination,
      destinationSprintId,
    };
  });
}
