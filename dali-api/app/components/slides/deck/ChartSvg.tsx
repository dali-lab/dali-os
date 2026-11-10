import type { ChartSpec } from "./content";
import { formatTick, niceTicks, pieSlices } from "./chart-math";

const LABEL = 26;
const LEGEND_H = 56;

interface Props {
  chart: ChartSpec;
  colors: string[];
  w: number;
  h: number;
}

const color = (colors: string[], i: number) => colors[i % colors.length];
const text = { fontFamily: "var(--slide-font-body)", fill: "var(--slide-muted)", fontSize: LABEL } as const;

function Legend({ names, colors, x, y }: { names: string[]; colors: string[]; x: number; y: number }) {
  let cursor = x;
  return (
    <g data-chart-legend>
      {names.map((name, i) => {
        const at = cursor;
        cursor += 52 + name.length * 15 + 28;
        return (
          <g key={i} transform={`translate(${at} ${y})`}>
            <rect x={0} y={-16} width={24} height={24} rx={6} style={{ fill: color(colors, i) }} />
            <text x={36} y={4} style={text}>
              {name}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Pie({ chart, colors, w, h }: Props) {
  const series = chart.data.series[0];
  const slices = pieSlices(series.values);
  const size = Math.min(h - 40, w * 0.5);
  const r = size / 2;
  const cx = 20 + r;
  const cy = h / 2;
  const point = (a: number) => `${cx + r * Math.sin(a)} ${cy - r * Math.cos(a)}`;
  const rowStep = Math.min(44, (h - 60) / Math.max(1, chart.data.labels.length));
  const drawn = slices.filter((s) => s.share > 0);
  return (
    <>
      {drawn.length === 1 ? (
        <circle cx={cx} cy={cy} r={r} style={{ fill: color(colors, slices.indexOf(drawn[0])) }} />
      ) : (
        slices.map((s, i) =>
          s.share > 0 ? (
            <path
              key={i}
              data-slice={i}
              d={`M ${cx} ${cy} L ${point(s.start)} A ${r} ${r} 0 ${s.end - s.start > Math.PI ? 1 : 0} 1 ${point(s.end)} Z`}
              style={{ fill: color(colors, i), stroke: "var(--slide-ground)", strokeWidth: 4 }}
            />
          ) : null
        )
      )}
      <g data-chart-legend>
        {chart.data.labels.map((label, i) => (
          <g key={i} transform={`translate(${cx + r + 56} ${40 + i * rowStep})`}>
            <rect x={0} y={-16} width={24} height={24} rx={6} style={{ fill: color(colors, i) }} />
            <text x={36} y={4} style={{ ...text, fill: "var(--slide-fg)" }}>
              {label} {Math.round(slices[i].share * 100)}%
            </text>
          </g>
        ))}
      </g>
    </>
  );
}

function Cartesian({ chart, colors, w, h }: Props) {
  const { labels, series } = chart.data;
  const all = series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(...all), Math.max(...all));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const top = series.length > 1 ? LEGEND_H + 16 : 24;
  const left = 24 + Math.max(...ticks.map((t) => formatTick(t).length)) * 16 + 24;
  const bottom = h - 64;
  const right = w - 24;
  const y = (v: number) => bottom - ((v - lo) / (hi - lo || 1)) * (bottom - top);
  const band = (right - left) / labels.length;
  const center = (i: number) => left + band * (i + 0.5);
  const group = band * 0.7;
  const barW = group / series.length;
  return (
    <>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={right} y1={y(t)} y2={y(t)} style={{ stroke: "var(--slide-rule)", strokeWidth: t === 0 ? 3 : 1.5 }} />
          <text x={left - 16} y={y(t) + 9} textAnchor="end" style={text}>
            {formatTick(t)}
          </text>
        </g>
      ))}
      {labels.map((label, i) => (
        <text key={i} x={center(i)} y={bottom + 44} textAnchor="middle" style={text}>
          {label}
        </text>
      ))}
      {chart.type === "bar"
        ? series.map((s, si) =>
            s.values.map((v, i) => {
              const x = center(i) - group / 2 + si * barW;
              const top0 = y(Math.max(v, 0));
              const height = Math.max(0, Math.abs(y(v) - y(0)));
              return <rect key={`${si}-${i}`} data-bar x={x + 2} y={top0} width={Math.max(1, barW - 4)} height={height} rx={Math.min(8, barW / 4)} style={{ fill: color(colors, si) }} />;
            })
          )
        : series.map((s, si) => (
            <g key={si} data-line={si}>
              <polyline
                fill="none"
                points={s.values.map((v, i) => `${center(i)},${y(v)}`).join(" ")}
                style={{ stroke: color(colors, si), strokeWidth: 6, strokeLinejoin: "round", strokeLinecap: "round" }}
              />
              {s.values.map((v, i) => (
                <circle key={i} cx={center(i)} cy={y(v)} r={9} style={{ fill: color(colors, si), stroke: "var(--slide-ground)", strokeWidth: 3 }} />
              ))}
            </g>
          ))}
      {series.length > 1 && <Legend names={series.map((s) => s.name)} colors={colors} x={left} y={32} />}
    </>
  );
}

export function ChartSvg(props: Props) {
  const { chart, w, h } = props;
  return (
    <svg
      data-chart={chart.type}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}
      role="img"
      aria-label={`${chart.type} chart`}
    >
      {chart.type === "pie" ? <Pie {...props} /> : <Cartesian {...props} />}
    </svg>
  );
}
