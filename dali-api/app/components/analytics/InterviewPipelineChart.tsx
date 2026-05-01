import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useChartColors } from "./useChartColors";

interface Props {
  scheduled: number;
  completed: number;
  cancelled: number;
  pendingInvite: number;
}

export function InterviewPipelineChart({ data }: { data: Props }) {
  const colors = useChartColors();

  const COLORS: Record<string, string> = {
    Scheduled: colors.teal,
    Completed: colors.green,
    "Pending Invite": colors.pink,
    Cancelled: colors.border,
  };
  const total = data.scheduled + data.completed + data.cancelled + data.pendingInvite;

  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        No interviews yet
      </div>
    );
  }

  const chartData = [
    { name: "Scheduled", value: data.scheduled },
    { name: "Completed", value: data.completed },
    { name: "Pending Invite", value: data.pendingInvite },
    { name: "Cancelled", value: data.cancelled },
  ].filter((d) => d.value > 0);

  return (
    <div>
      <div className="relative">
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={75}
              dataKey="value"
              stroke="none"
            >
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={COLORS[entry.name]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-xl font-bold text-foreground">{total}</span>
        </div>
      </div>
      <div className="flex justify-center gap-4 text-xs mt-2">
        {chartData.map((d) => (
          <div key={d.name} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: COLORS[d.name] }}
            />
            <span className="text-muted-foreground">
              {d.name} ({d.value})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
