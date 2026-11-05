import {
  createMilestone,
  createPeriod,
  createTask,
  deleteMilestone,
  deletePeriod,
  deleteTask,
  moveTask,
  periodWeekCounts,
  saveTermWeeks,
  updateMilestone,
  updatePeriod,
  updateTask,
  type Result,
} from "./taskboard.server";
import {
  isStatus,
  parseMilestoneInput,
  parsePeriodInput,
  parseSettingsInput,
  parseTaskInput,
  type Parsed,
} from "./validate";

function id(form: FormData): string {
  const v = form.get("id");
  return typeof v === "string" ? v : "";
}

function bad(error: string): Result<unknown> {
  return { ok: false, status: 400, error };
}

function unwrap<T>(parsed: Parsed<T>): { value: T } | { error: Result<unknown> } {
  return parsed.ok ? { value: parsed.value } : { error: bad(parsed.error) };
}

export async function handleTaskboardAction(
  form: FormData,
  actorId: string,
  now: Date,
): Promise<Result<unknown>> {
  const intent = form.get("intent");
  const counts = await periodWeekCounts();
  const weekCount = (periodId: string) => counts.get(periodId) ?? null;

  switch (intent) {
    case "task-save": {
      const parsed = unwrap(parseTaskInput(form, weekCount));
      if ("error" in parsed) return parsed.error;
      const taskId = id(form);
      return taskId ? updateTask(taskId, parsed.value) : createTask(parsed.value, actorId);
    }
    case "task-delete":
      return deleteTask(id(form));
    case "task-move": {
      const status = form.get("status");
      const week = Number(form.get("week"));
      if (!isStatus(status)) return bad("Pick a valid status.");
      if (!Number.isInteger(week)) return bad("Pick a valid week.");
      return moveTask({
        id: id(form),
        status,
        periodId: String(form.get("periodId") ?? ""),
        week,
        actorId,
        now,
      });
    }
    case "milestone-save": {
      const parsed = unwrap(parseMilestoneInput(form, weekCount));
      if ("error" in parsed) return parsed.error;
      const milestoneId = id(form);
      return milestoneId ? updateMilestone(milestoneId, parsed.value) : createMilestone(parsed.value);
    }
    case "milestone-delete":
      return deleteMilestone(id(form));
    case "period-save": {
      const parsed = unwrap(parsePeriodInput(form));
      if ("error" in parsed) return parsed.error;
      const periodId = id(form);
      return periodId ? updatePeriod(periodId, parsed.value) : createPeriod(parsed.value);
    }
    case "period-delete":
      return deletePeriod(id(form));
    case "settings-save": {
      const parsed = unwrap(parseSettingsInput(form));
      if ("error" in parsed) return parsed.error;
      return saveTermWeeks(parsed.value.termWeeks);
    }
    default:
      return bad("Unknown action.");
  }
}

export function resultId(result: Result<unknown>): string | undefined {
  if (!result.ok) return undefined;
  const value = result.value as { id?: unknown } | undefined;
  return typeof value?.id === "string" ? value.id : undefined;
}
