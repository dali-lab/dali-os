import type { Route } from "./+types/api.sprints.$id";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { TASK_CARD_SELECT, toTaskCard } from "../lib/task-card.server";
import type { TaskStatus } from "../lib/task-board";

// GET /api/sprints/:id — a closed sprint's board as it stood at close: each
// snapshotted task with its status then, and where unfinished work rolled.
export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const sprint = await prisma.sprint.findUnique({
    where: { id: params.id },
    select: {
      projectId: true,
      snapshots: {
        select: {
          statusAtClose: true,
          carriedTo: { select: { number: true } },
          task: { select: TASK_CARD_SELECT },
        },
      },
    },
  });
  if (!sprint) {
    return withCors(request, Response.json({ error: "Sprint not found" }, { status: 404 }));
  }
  const gate = await requireProjectEditAccess(request, sprint.projectId);
  if (!gate.ok) return gate.response;

  const cards = sprint.snapshots.map((s) => ({
    ...toTaskCard(s.task),
    status: s.statusAtClose as TaskStatus,
    carriedTo: s.carriedTo ? `Sprint ${s.carriedTo.number}` : null,
  }));
  return withCors(request, Response.json({ cards }));
}
