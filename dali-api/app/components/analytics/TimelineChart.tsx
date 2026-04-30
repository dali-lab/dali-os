import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface TimelineRow {
  date: string;
  submissions: number;
  reviewsCompleted: number;
}

export function TimelineChart({ data }: { data: TimelineRow[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        No activity yet
      </div>
    );
  }

  // Format dates for display
  const formatted = data.map((d) => ({
    ...d,
    label: new Date(d.date + "T12:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={formatted} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
        <Area
          type="monotone"
          dataKey="submissions"
          name="Submissions"
          stroke="#3b82f6"
          fill="#bfdbfe"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="reviewsCompleted"
          name="Reviews"
          stroke="#16a34a"
          fill="#bbf7d0"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
