import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "~/lib/cn";
import { orderedRange, shortDay } from "./chart-range";

export type ChartSeries = {
  key: string;
  name: string;
  color: string;
  dashed?: boolean;
};

type Row = { day: string } & Record<string, number | string>;

/**
 * Daily line chart. With `onSelectRange`, dragging across the plot picks the
 * days between the press and the release.
 */
export function TimeSeriesChart({
  data,
  series,
  formatValue,
  allowDecimals = false,
  onSelectRange,
  className = "h-72",
}: {
  data: Row[];
  series: ChartSeries[];
  formatValue?: (value: number) => string;
  allowDecimals?: boolean;
  onSelectRange?: (range: { from: string; to: string }) => void;
  className?: string;
}) {
  const [drag, setDrag] = useState<{ start: string; end: string } | null>(null);
  const selectable = !!onSelectRange;
  const labelOf = (s: { activeLabel?: string | number } | null | undefined) =>
    s?.activeLabel == null ? null : String(s.activeLabel);

  return (
    <div
      className={cn(
        className,
        "[&_.recharts-surface]:outline-none [&_.recharts-wrapper]:outline-none",
        selectable && "cursor-crosshair select-none",
      )}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
          onMouseDown={(s) => {
            const day = selectable ? labelOf(s) : null;
            if (day) setDrag({ start: day, end: day });
          }}
          onMouseMove={(s) => {
            const day = labelOf(s);
            if (drag && day && day !== drag.end) setDrag({ ...drag, end: day });
          }}
          onMouseUp={() => {
            const range = drag && orderedRange(drag.start, drag.end);
            setDrag(null);
            if (range) onSelectRange?.(range);
          }}
          onMouseLeave={() => setDrag(null)}
        >
          <CartesianGrid stroke="var(--color-os-container)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={shortDay}
            tick={{ fontSize: 12, fill: "var(--color-os-muted)" }}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis
            tick={{ fontSize: 12, fill: "var(--color-os-muted)" }}
            tickFormatter={formatValue}
            tickLine={false}
            axisLine={false}
            width={56}
            allowDecimals={allowDecimals}
          />
          <ChartTooltip
            labelFormatter={(day) => shortDay(String(day))}
            formatter={formatValue ? (v) => formatValue(Number(v)) : undefined}
            contentStyle={{
              background: "var(--color-os-card)",
              border: "1px solid var(--color-os-container)",
              borderRadius: 12,
              fontSize: 13,
              color: "var(--color-foreground)",
            }}
            labelStyle={{ color: "var(--color-os-grey)" }}
            itemStyle={{ color: "var(--color-foreground)" }}
            cursor={{ stroke: "var(--color-os-container-hi)" }}
          />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "5 4" : undefined}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          ))}
          {drag && drag.start !== drag.end && (
            <ReferenceArea
              x1={drag.start}
              x2={drag.end}
              fill="var(--color-os-accent)"
              fillOpacity={0.12}
              stroke="var(--color-os-accent)"
              strokeOpacity={0.4}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChartLegend({ series }: { series: ChartSeries[] }) {
  return (
    <div className="flex flex-wrap gap-5 text-xs text-os-grey">
      {series.map((s) => (
        <span key={s.key} className="flex items-center gap-2">
          {s.dashed ? (
            <span className="w-4 border-t-2 border-dashed" style={{ borderColor: s.color }} />
          ) : (
            <span className="h-0.5 w-4 rounded" style={{ background: s.color }} />
          )}
          {s.name}
        </span>
      ))}
    </div>
  );
}
