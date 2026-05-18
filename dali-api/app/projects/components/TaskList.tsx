import type { TaskWithRelations } from "~/projects/lib/queries";

interface Props {
  tasks: TaskWithRelations[];
  onSelect: (taskId: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  Todo: "To do",
  InProgress: "In progress",
  InReview: "In review",
  Done: "Done",
  Cancelled: "Cancelled",
};

export function TaskList({ tasks, onSelect }: Props) {
  if (tasks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">No tasks match.</p>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Title</th>
            <th className="text-left px-3 py-2 font-medium">Status</th>
            <th className="text-left px-3 py-2 font-medium">Priority</th>
            <th className="text-left px-3 py-2 font-medium">Assignees</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {tasks.map((t) => (
            <tr
              key={t.id}
              className="hover:bg-muted/40 cursor-pointer"
              onClick={() => onSelect(t.id)}
            >
              <td className="px-3 py-2 font-medium">{t.title}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {STATUS_LABEL[t.status] ?? t.status}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{t.priority}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {t.assignees.length === 0
                  ? "—"
                  : t.assignees
                      .map((a) => `${a.user.firstName} ${a.user.lastName}`)
                      .join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
