import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { FilterBar, type FilterBarColumn } from "~/components/FilterBar";
import { MultiSelectList } from "~/components/ui/floating";
import { DateField } from "~/components/ui/DateField";
import { FormField } from "~/components/ui/FormField";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import {
  filterSummary,
  parseAnswerFilters,
  withAnswerFilters,
  type AnswerFilter,
  type FilterableQuestion,
} from "~/forms/lib/answer-filters";
import { NUMBER_PATTERN } from "~/forms/lib/version-summary";

export function useAnswerFilters(questions: FilterableQuestion[]) {
  const [searchParams, setSearchParams] = useSearchParams();
  const active = useMemo(() => parseAnswerFilters(searchParams, questions), [searchParams, questions]);
  const update = (change: (current: AnswerFilter[]) => AnswerFilter[]) =>
    setSearchParams((prev) => withAnswerFilters(prev, change(parseAnswerFilters(prev, questions))), {
      replace: true,
      preventScrollReset: true,
    });
  return {
    active,
    setFilter(key: string, filter: AnswerFilter | null) {
      update((current) => {
        const rest = current.filter((f) => f.key !== key);
        if (!filter) return rest;
        const at = current.findIndex((f) => f.key === key);
        return at < 0 ? [...rest, filter] : [...rest.slice(0, at), filter, ...rest.slice(at)];
      });
    },
  };
}

export function responseCountText(matching: number, total: number) {
  const noun = total === 1 ? "response" : "responses";
  return matching === total ? `${total} ${noun}` : `${matching} of ${total} ${noun}`;
}

function useDebounced(value: string, apply: (value: string) => void) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => apply(draft), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  return [draft, setDraft] as const;
}

function ContainsInput({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const { formClass } = useOsChrome();
  const [draft, setDraft] = useDebounced(value, onChange);
  return (
    <div className={cn(formClass, "px-1.5 pt-1.5")}>
      <FormField label="Contains" value={draft} onChange={setDraft} />
    </div>
  );
}

function BoundInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useDebounced(value, (next) => {
    if (next.trim() === "" || NUMBER_PATTERN.test(next.trim())) onChange(next.trim());
  });
  return <FormField label={label} value={draft} onChange={setDraft} />;
}

function RangeInputs({
  type,
  range,
  onChange,
}: {
  type: FilterableQuestion["type"];
  range: { min?: string; max?: string };
  onChange: (range: { min?: string; max?: string }) => void;
}) {
  const { formClass } = useOsChrome();
  const set = (edge: "min" | "max", value: string) =>
    onChange({ min: range.min, max: range.max, [edge]: value || undefined });
  if (type === "date") {
    return (
      <div className="grid grid-cols-2 gap-2 px-1.5 pt-1.5">
        <DateField mode="date" ariaLabel="From date" placeholder="From" value={range.min ?? ""} onChange={(v) => set("min", v)} />
        <DateField mode="date" ariaLabel="To date" placeholder="To" value={range.max ?? ""} onChange={(v) => set("max", v)} />
      </div>
    );
  }
  return (
    <div className={cn(formClass, "grid grid-cols-2 gap-2 px-1.5 pt-1.5")}>
      <BoundInput label="Min" value={range.min ?? ""} onChange={(v) => set("min", v)} />
      <BoundInput label="Max" value={range.max ?? ""} onChange={(v) => set("max", v)} />
    </div>
  );
}

function PresenceItems({
  current,
  onPick,
}: {
  current?: AnswerFilter;
  onPick: (kind: "answered" | "blank" | null) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Answer presence" className="mt-2 border-t border-os-container pt-1.5">
      {(
        [
          ["answered", "Answered"],
          ["blank", "No answer"],
        ] as const
      ).map(([kind, label]) => {
        const checked = current?.kind === kind;
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onPick(checked ? null : kind)}
            className={cn(
              "flex h-9 w-full items-center rounded-lg px-2.5 text-left text-sm transition-colors hover:bg-os-hover focus-visible:bg-os-hover focus-visible:outline-none",
              checked ? "font-semibold text-os-accent" : "text-foreground",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function QuestionPicker({
  question,
  current,
  setFilter,
  autoFocus,
}: {
  question: FilterableQuestion;
  current?: AnswerFilter;
  setFilter: (filter: AnswerFilter | null) => void;
  autoFocus: boolean;
}) {
  const { key } = question;
  const values = current?.kind === "is" ? current.values : [];
  return (
    <>
      {question.primary === "is" && (
        <MultiSelectList
          values={values}
          options={question.options ?? []}
          onToggle={(v) => {
            const next = values.includes(v) ? values.filter((x) => x !== v) : [...values, v];
            setFilter(next.length ? { key, kind: "is", values: next } : null);
          }}
          onClear={() => setFilter(null)}
          clearLabel={`Clear ${question.label.toLowerCase()}`}
          ariaLabel={question.label}
          searchPlaceholder={`Search ${question.label.toLowerCase()}`}
          autoFocus={autoFocus}
        />
      )}
      {question.primary === "contains" && (
        <ContainsInput
          value={current?.kind === "contains" ? current.text : ""}
          onChange={(text) => setFilter(text.trim() ? { key, kind: "contains", text: text.trim() } : null)}
        />
      )}
      {question.primary === "range" && (
        <RangeInputs
          type={question.type}
          range={current?.kind === "range" ? current : {}}
          onChange={({ min, max }) =>
            setFilter(
              min === undefined && max === undefined
                ? null
                : { key, kind: "range", ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) },
            )
          }
        />
      )}
      <PresenceItems current={current} onPick={(kind) => setFilter(kind ? { key, kind } : null)} />
    </>
  );
}

export function ResultsFilterBar({
  questions,
  slotOptions,
  count,
}: {
  questions: FilterableQuestion[];
  slotOptions: string[];
  count: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { active, setFilter } = useAnswerFilters(questions);
  const slot = searchParams.get("slot") ?? "";

  const setSlot = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.delete("page");
    if (value) next.set("slot", value);
    else next.delete("slot");
    setSearchParams(next, { replace: true, preventScrollReset: true });
  };

  const columns: FilterBarColumn[] = questions.map((q) => {
    const current = active.find((f) => f.key === q.key);
    return {
      key: q.key,
      label: q.label,
      prefix: q.number !== undefined ? `Q${q.number}` : undefined,
      count: !current ? 0 : current.kind === "is" ? current.values.length : 1,
      summary: current ? filterSummary(current, q) : "",
      status: current?.kind === "is" || !current ? undefined : "1 applied",
      onClear: () => setFilter(q.key, null),
      renderPicker: ({ autoFocus }) => (
        <QuestionPicker
          question={q}
          current={current}
          setFilter={(f) => setFilter(q.key, f)}
          autoFocus={autoFocus}
        />
      ),
    };
  });

  if (slotOptions.length > 0) {
    columns.push({
      key: "slot",
      label: "Slot",
      count: slot ? 1 : 0,
      summary: slot,
      onClear: () => setSlot(""),
      renderPicker: ({ autoFocus }) => (
        <MultiSelectList
          values={slot ? [slot] : []}
          options={slotOptions.map((s) => ({ value: s, label: s }))}
          onToggle={(v) => setSlot(v === slot ? "" : v)}
          ariaLabel="Slot"
          searchPlaceholder="Search slots"
          autoFocus={autoFocus}
        />
      ),
    });
  }

  if (columns.length === 0) return null;

  const clearAll = () => {
    const next = withAnswerFilters(searchParams, []);
    next.delete("slot");
    setSearchParams(next, { replace: true, preventScrollReset: true });
  };

  return <FilterBar columns={columns} onClearAll={clearAll} count={count} />;
}
