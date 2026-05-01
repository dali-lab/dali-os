import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useChartColors } from "./useChartColors";

interface DecisionRow {
  domain: string;
  accepted: number;
  rejected: number;
  waitlisted: number;
  invitedToInterview: number;
  pending: number;
}

export function DecisionBreakdownChart({ data }: { data: DecisionRow[] }) {
  const colors = useChartColors();

  if (data.length === 0 || data.every((d) => d.accepted + d.rejected + d.waitlisted + d.invitedToInterview + d.pending === 0)) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        No decisions yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 50 + 60)}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
        <XAxis type="number" tick={{ fontSize: 12 }} />
        <YAxis type="category" dataKey="domain" tick={{ fontSize: 12 }} width={90} />
        <Tooltip />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="accepted" name="Accepted" fill={colors.green} stackId="a" />
        <Bar dataKey="waitlisted" name="Waitlisted" fill={colors.pink} stackId="a" />
        <Bar dataKey="invitedToInterview" name="Interview" fill={colors.teal} stackId="a" />
        <Bar dataKey="rejected" name="Rejected" fill={colors.coral} stackId="a" />
        <Bar dataKey="pending" name="Pending" fill={colors.border} stackId="a" />
      </BarChart>
    </ResponsiveContainer>
  );
}
