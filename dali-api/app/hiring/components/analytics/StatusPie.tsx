import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { useChartColors } from "~/components/analytics/useChartColors";

export interface StatusSlice {
  status: string;
  label: string;
  count: number;
}

interface Props {
  data: StatusSlice[];
  selectedStatus: string | null;
  /** Clicking the selected slice again passes null (clears the filter). */
  onSelect: (status: string | null) => void;
}

function renderSliceLabel(props: any) {
  const { x, y, label, count, textAnchor } = props;
  return (
    <text
      x={x}
      y={y}
      textAnchor={textAnchor}
      dominantBaseline="central"
      fontSize={12}
      fill="var(--color-foreground)"
    >
      {`${label}: ${count}`}
    </text>
  );
}

export function StatusPie({ data, selectedStatus, onSelect }: Props) {
  const colors = useChartColors();

  const palette = [
    colors.teal,
    colors.coral,
    colors.green,
    colors.pink,
    colors.yellow,
    colors.coralLight,
    colors.muted,
    colors.border,
  ];

  const colorFor = (status: string, i: number) => {
    const map: Record<string, string> = {
      Accepted: colors.green,
      AcceptedElsewhere: colors.muted,
      Rejected: colors.coral,
      Waitlisted: colors.pink,
      InvitedToInterview: colors.teal,
      InterviewScheduled: colors.teal,
      PostInterviewPending: colors.yellow,
      Pending: colors.yellow,
      InProgress: colors.coralLight,
      ApplicationOpen: colors.muted,
      Withdrawn: colors.border,
    };
    return map[status] ?? palette[i % palette.length];
  };

  const filtered = data.filter((d) => d.count > 0);
  const total = filtered.reduce((sum, d) => sum + d.count, 0);

  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-72 text-muted-foreground">
        No applications match the current filter.
      </div>
    );
  }

  function handleClick(slice: StatusSlice) {
    onSelect(selectedStatus === slice.status ? null : slice.status);
  }

  return (
    <div className="w-full h-72 sm:h-80 overflow-hidden">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={filtered}
            dataKey="count"
            nameKey="label"
            cx="50%"
            cy="50%"
            outerRadius="60%"
            label={renderSliceLabel}
            labelLine={{ stroke: "var(--color-muted-foreground)" }}
            onClick={(_, idx) => handleClick(filtered[idx])}
            isAnimationActive={false}
          >
            {filtered.map((slice, i) => {
              const isSelected = selectedStatus === slice.status;
              const isDimmed = selectedStatus !== null && !isSelected;
              return (
                <Cell
                  key={slice.status}
                  fill={colorFor(slice.status, i)}
                  stroke={isSelected ? "#000" : "#fff"}
                  strokeWidth={isSelected ? 3 : 1}
                  opacity={isDimmed ? 0.35 : 1}
                  style={{ cursor: "pointer" }}
                />
              );
            })}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: 6,
              color: "var(--color-foreground)",
            }}
            labelStyle={{ color: "var(--color-foreground)" }}
            itemStyle={{ color: "var(--color-foreground)" }}
            formatter={((value: any, _name: any, props: any) => [
              `${value} (${(((value as number) / total) * 100).toFixed(0)}%)`,
              props.payload.label,
            ]) as any}
          />
          <Legend
            iconSize={10}
            wrapperStyle={{ fontSize: 12, cursor: "pointer" }}
            onClick={(entry: any) => {
              const slice = filtered.find((s) => s.label === entry.value);
              if (slice) handleClick(slice);
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
