import type { BoardData } from "~/education/lib/taskboard/taskboard.server";
import type { TaskStatus } from "~/education/lib/taskboard/rollover";
import type { CurrentPosition, WeekRef } from "~/education/lib/taskboard/weeks";

export type TaskboardData = BoardData & {
  today: string;
  current: CurrentPosition | null;
  viewed: WeekRef | null;
  userId: string;
};

export type Zoom = "year" | "term" | "week";

export type TaskDraft = {
  title: string;
  description: string;
  periodId: string;
  week: number;
  weekday: number;
  milestoneId: string;
  assigneeIds: string[];
  status: TaskStatus;
};

export type Dialog =
  | { kind: "task"; taskId: string | null; draft?: Partial<TaskDraft> }
  | {
      kind: "milestone";
      milestoneId: string | null;
      periodId?: string;
      name?: string;
      returnToTask?: { taskId: string | null; draft: TaskDraft };
    }
  | { kind: "milestone-detail"; milestoneId: string }
  | { kind: "period"; periodId: string | null }
  | null;

export type SubmitResult = { id?: string };

export type Submit = (fields: Record<string, string>, after?: (result: SubmitResult) => Dialog) => void;
