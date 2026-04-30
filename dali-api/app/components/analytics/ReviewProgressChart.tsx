import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
} from "recharts";

interface Props {
  byStatus: { notStarted: number; inProgress: number; submitted: number };
  byRecommendation: Record<string, number>;
}

const STATUS_COLORS: Record<string, string> = {
  "Not Started": "#d1d5db",
  "In Progress": "#f59e0b",
  Submitted: "#16a34a",
};

const RECOMMENDATION_ORDER = [
  "Strong Hire",
  "Hire",
  "Lean Hire",
  "Lean No Hire",
  "No Hire",
];

const RECOMMENDATION_COLORS: Record<string, string> = {
  "Strong Hire": "#16a34a",
  Hire: "#22c55e",
  "Lean Hire": "#f59e0b",
  "Lean No Hire": "#f97316",
  "No Hire": "#dc2626",
};

export function ReviewProgressChart({ byStatus, byRecommendation }: Props) {
  const total = byStatus.notStarted + byStatus.inProgress + byStatus.submitted;

  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        No reviews assigned yet
      </div>
    );
  }

  const statusData = [
    { name: "Not Started", value: byStatus.notStarted },
    { name: "In Progress", value: byStatus.inProgress },
    { name: "Submitted", value: byStatus.submitted },
  ].filter((d) => d.value > 0);

  const recData = RECOMMENDATION_ORDER.filter((r) => (byRecommendation[r] ?? 0) > 0).map(
    (r) => ({ name: r, value: byRecommendation[r] })
  );

  const pct = total > 0 ? Math.round((byStatus.submitted / total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Donut */}
      <div className="relative">
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie
              data={statusData}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={75}
              dataKey="value"
              stroke="none"
            >
              {statusData.map((entry) => (
                <Cell key={entry.name} fill={STATUS_COLORS[entry.name]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-xl font-bold text-foreground">{pct}%</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-4 text-xs">
        {statusData.map((d) => (
          <div key={d.name} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: STATUS_COLORS[d.name] }}
            />
            <span className="text-muted-foreground">
              {d.name} ({d.value})
            </span>
          </div>
        ))}
      </div>

      {/* Recommendation bar */}
      {recData.length > 0 && (
        <>
          <h4 className="text-xs font-medium text-muted-foreground mt-2">Recommendations</h4>
          <ResponsiveContainer width="100%" height={recData.length * 28 + 16}>
            <BarChart
              data={recData}
              layout="vertical"
              margin={{ left: 0, right: 8, top: 0, bottom: 0 }}
            >
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={85} />
              <Tooltip />
              <Bar dataKey="value" name="Count" radius={[0, 3, 3, 0]}>
                {recData.map((entry) => (
                  <Cell key={entry.name} fill={RECOMMENDATION_COLORS[entry.name] ?? "#9ca3af"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}
