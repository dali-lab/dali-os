import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { Segmented } from "~/components/ui/Segmented";
import {
  CHART_LABELS,
  CHART_TYPES,
  chartDataFromTsv,
  MAX_CHART_CATEGORIES,
  MAX_CHART_SERIES,
  type ChartData,
  type ChartSpec,
  type ChartType,
} from "~/components/slides/deck/content";
import type { RenderElement } from "~/components/slides/deck/snapshot";
import type { InspectorFreeform } from "./ElementInspector";
import { IconPickerModal, VideoUrlModal } from "./InsertPickers";
import { ICONS } from "~/components/slides/deck/icon-set";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-os-grey">{title}</h3>
      {children}
    </section>
  );
}

function Cell({ value, label, align = "left", disabled, onCommit }: { value: string; label: string; align?: "left" | "right"; disabled: boolean; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  return (
    <input
      type="text"
      aria-label={label}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget.blur(), e.preventDefault());
        else if (e.key === "Escape") setDraft(value);
      }}
      className={`w-full min-w-[3.5rem] rounded-md border border-os-container bg-transparent px-1.5 py-1 text-xs text-foreground focus:border-os-accent focus:outline-none disabled:opacity-60 ${align === "right" ? "text-right tabular-nums" : ""}`}
    />
  );
}

const asNumber = (text: string, fallback: number) => {
  const n = Number(text.trim().replace(/,/g, ""));
  return text.trim() !== "" && Number.isFinite(n) ? n : fallback;
};

export function ChartGrid({ chart, editable, onChange }: { chart: ChartSpec; editable: boolean; onChange: (chart: ChartSpec) => void }) {
  const { labels, series } = chart.data;
  const setData = (data: ChartData) => onChange({ ...chart, data });
  const setLabel = (i: number, text: string) => setData({ labels: labels.map((l, j) => (j === i ? text : l)), series });
  const setName = (si: number, name: string) => setData({ labels, series: series.map((s, j) => (j === si ? { ...s, name } : s)) });
  const setValue = (si: number, i: number, text: string) =>
    setData({ labels, series: series.map((s, j) => (j === si ? { ...s, values: s.values.map((v, k) => (k === i ? asNumber(text, v) : v)) } : s)) });
  const addRow = () => setData({ labels: [...labels, `Item ${labels.length + 1}`], series: series.map((s) => ({ ...s, values: [...s.values, 0] })) });
  const removeRow = (i: number) => setData({ labels: labels.filter((_, j) => j !== i), series: series.map((s) => ({ ...s, values: s.values.filter((_, j) => j !== i) })) });
  const addSeries = () => setData({ labels, series: [...series, { name: `Series ${series.length + 1}`, values: labels.map(() => 0) }] });
  const removeSeries = (si: number) => setData({ labels, series: series.filter((_, j) => j !== si) });
  const onPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text/plain");
    if (!editable || !/[\t\n]/.test(text)) return;
    const data = chartDataFromTsv(text);
    if (!data) return;
    e.preventDefault();
    setData(data);
  };
  return (
    <div onPaste={onPaste} className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table data-chart-grid className="w-full border-separate border-spacing-1">
          <thead>
            <tr>
              <th aria-label="Category" />
              {series.map((s, si) => (
                <th key={si} className="font-normal">
                  <div className="flex items-center gap-0.5">
                    <Cell value={s.name} label={`Series ${si + 1} name`} disabled={!editable} onCommit={(t) => setName(si, t)} />
                    {editable && series.length > 1 && <IconButton label={`Remove series ${si + 1}`} icon={Trash2} onClick={() => removeSeries(si)} />}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((label, i) => (
              <tr key={i}>
                <td>
                  <Cell value={label} label={`Row ${i + 1} label`} disabled={!editable} onCommit={(t) => setLabel(i, t)} />
                </td>
                {series.map((s, si) => (
                  <td key={si}>
                    <Cell value={String(s.values[i] ?? 0)} label={`Row ${i + 1} ${s.name || `series ${si + 1}`}`} align="right" disabled={!editable} onCommit={(t) => setValue(si, i, t)} />
                  </td>
                ))}
                <td>{editable && labels.length > 1 && <IconButton label={`Remove row ${i + 1}`} icon={Trash2} onClick={() => removeRow(i)} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="xs" disabled={labels.length >= MAX_CHART_CATEGORIES} onClick={addRow}>
            <Plus className="h-3 w-3" aria-hidden />
            Row
          </Button>
          {chart.type !== "pie" && (
            <Button variant="secondary" size="xs" disabled={series.length >= MAX_CHART_SERIES} onClick={addSeries}>
              <Plus className="h-3 w-3" aria-hidden />
              Series
            </Button>
          )}
        </div>
      )}
      <p className="text-xs text-os-grey">Paste cells from a spreadsheet to replace the data.{chart.type === "pie" ? " A pie chart uses the first series." : ""}</p>
    </div>
  );
}

function ChartSection({ element, editable, onChange }: { element: RenderElement; editable: boolean; onChange: (chart: ChartSpec) => void }) {
  const chart = element.chart;
  if (!chart) return <p className="text-sm text-os-grey">This chart has no data.</p>;
  return (
    <>
      <Section title="Chart type">
        <Segmented
          ariaLabel="Chart type"
          fullWidth
          value={chart.type}
          onChange={(type: ChartType) => onChange({ ...chart, type })}
          options={CHART_TYPES.map((value) => ({ value, label: CHART_LABELS[value].replace(" chart", ""), disabled: !editable }))}
        />
      </Section>
      <Section title="Data">
        <ChartGrid chart={chart} editable={editable} onChange={onChange} />
      </Section>
    </>
  );
}

function IconSection({ element, editable, onPick }: { element: RenderElement; editable: boolean; onPick: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const Icon = element.icon ? ICONS[element.icon] : null;
  return (
    <Section title="Icon">
      <Button variant="secondary" size="sm" disabled={!editable} onClick={() => setOpen(true)}>
        {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
        Change icon
      </Button>
      {open && (
        <IconPickerModal
          open
          current={element.icon}
          onClose={() => setOpen(false)}
          onPick={(name) => {
            onPick(name);
            setOpen(false);
          }}
        />
      )}
    </Section>
  );
}

function VideoSection({ element, editable, onChange }: { element: RenderElement; editable: boolean; onChange: (url: string) => boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Section title="Video">
      <p className="break-all text-xs text-os-grey">{element.videoUrl}</p>
      <Button variant="secondary" size="sm" disabled={!editable} onClick={() => setOpen(true)}>
        Change video
      </Button>
      {open && (
        <VideoUrlModal
          open
          current={element.videoUrl}
          title="Change video"
          confirmLabel="Save"
          onClose={() => setOpen(false)}
          onSubmit={(url) => {
            if (onChange(url)) setOpen(false);
          }}
        />
      )}
      <p className="text-xs text-os-grey">Click the poster while presenting to play it.</p>
    </Section>
  );
}

export function ContentSection({ element, editable, freeform }: { element: RenderElement; editable: boolean; freeform: InspectorFreeform }) {
  if (element.kind === "chart" && freeform.onChart) return <ChartSection element={element} editable={editable} onChange={(chart) => freeform.onChart!(element.id, chart)} />;
  if (element.kind === "icon" && freeform.onIcon) return <IconSection element={element} editable={editable} onPick={(name) => freeform.onIcon!(element.id, name)} />;
  if (element.kind === "video" && freeform.onVideo) return <VideoSection element={element} editable={editable} onChange={(url) => freeform.onVideo!(element.id, url)} />;
  return null;
}
