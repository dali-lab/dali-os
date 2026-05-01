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

interface FunnelRow {
  domain: string;
  submitted: number;
  reviewed: number;
  interviewed: number;
  accepted: number;
  rejected: number;
  waitlisted: number;
  pending: number;
}

export function FunnelChart({ data }: { data: FunnelRow[] }) {
  const colors = useChartColors();

  if (data.length === 0 || data.every((d) => d.submitted === 0)) {
    return <EmptyState />;
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 60 + 60)}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
        <XAxis type="number" tick={{ fontSize: 12 }} />
        <YAxis type="category" dataKey="domain" tick={{ fontSize: 12 }} width={90} />
        <Tooltip />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="submitted" name="Submitted" fill={colors.border} stackId="a" />
        <Bar dataKey="reviewed" name="Reviewed" fill={colors.teal} stackId="b" />
        <Bar dataKey="interviewed" name="Interviewed" fill={colors.pink} stackId="c" />
        <Bar dataKey="accepted" name="Accepted" fill={colors.green} stackId="d" />
        <Bar dataKey="waitlisted" name="Waitlisted" fill={colors.yellow} stackId="d" />
        <Bar dataKey="rejected" name="Rejected" fill={colors.coral} stackId="d" />
        <Bar dataKey="pending" name="Pending" fill={colors.border} stackId="d" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
      No application data yet
    </div>
  );
}
