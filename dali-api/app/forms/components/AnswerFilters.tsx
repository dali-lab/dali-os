import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { ArrowLeft, Check, SlidersHorizontal, X } from "lucide-react";
import { Popover } from "~/components/ui/floating";
import {
  FilterCountBadge,
  FilterGroup,
  FilterPill,
  FilterResetButton,
  FilterSectionLabel,
  customizeButtonClass,
  filterPanelClass,
} from "~/components/ui/filter-panel";
import { SearchInput } from "~/components/ui/SearchInput";
import { DateField } from "~/components/ui/DateField";
import { FormField } from "~/components/ui/FormField";
import { useOsChrome } from "~/components/os-chrome";
import {
  filterChipText,
  parseAnswerFilters,
  withAnswerFilters,
  type AnswerFilter,
  type FilterKind,
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
    // Replaces the question's filter in place; null removes it.
    setFilter(key: string, filter: AnswerFilter | null) {
      update((current) => {
        const rest = current.filter((f) => f.key !== key);
        if (!filter) return rest;
        const at = current.findIndex((f) => f.key === key);
        return at < 0 ? [...rest, filter] : [...rest.slice(0, at), filter, ...rest.slice(at)];
      });
    },
    clear: () => update(() => []),
  };
}

type Filters = ReturnType<typeof useAnswerFilters>;

const MODE_LABELS: Record<FilterKind, string> = {
  is: "Is any of",
  contains: "Contains",
  range: "Between",
  answered: "Answered",
  blank: "No answer",
};

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

function ContainsControl({ filter, onChange }: { filter?: AnswerFilter; onChange: (text: string) => void }) {
  const current = filter?.kind === "contains" ? filter.text : "";
  const [draft, setDraft] = useDebounced(current, onChange);
  return (
    <SearchInput
      size="sm"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      placeholder="Text to find"
      aria-label="Contains text"
    />
  );
}

function BoundField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useDebounced(value, (next) => {
    if (next.trim() === "" || NUMBER_PATTERN.test(next.trim())) onChange(next.trim());
  });
  return <FormField label={label} value={draft} onChange={setDraft} />;
}

function RangeControl({
  type,
  filter,
  onChange,
}: {
  type: FilterableQuestion["type"];
  filter?: AnswerFilter;
  onChange: (range: { min?: string; max?: string }) => void;
}) {
  const { formClass } = useOsChrome();
  const range: { min?: string; max?: string } = filter?.kind === "range" ? filter : {};
  const set = (edge: "min" | "max", value: string) => {
    const next = { min: range.min, max: range.max, [edge]: value || undefined };
    onChange(next);
  };
  if (type === "date") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <DateField mode="date" ariaLabel="From date" placeholder="From" value={range.min ?? ""} onChange={(v) => set("min", v)} />
        <DateField mode="date" ariaLabel="To date" placeholder="To" value={range.max ?? ""} onChange={(v) => set("max", v)} />
      </div>
    );
  }
  return (
    <div className={`${formClass} grid grid-cols-2 gap-2`}>
      <BoundField label="Min" value={range.min ?? ""} onChange={(v) => set("min", v)} />
      <BoundField label="Max" value={range.max ?? ""} onChange={(v) => set("max", v)} />
    </div>
  );
}

function QuestionControls({
  question,
  filters,
  onBack,
}: {
  question: FilterableQuestion;
  filters: Filters;
  onBack: () => void;
}) {
  const current = filters.active.find((f) => f.key === question.key);
  const [mode, setMode] = useState<FilterKind>(current?.kind ?? question.primary);
  const set = (filter: AnswerFilter | null) => filters.setFilter(question.key, filter);

  function pickMode(next: FilterKind) {
    setMode(next);
    if (next === "answered" || next === "blank") set({ key: question.key, kind: next });
    else if (current && current.kind !== next) set(null);
  }

  const values = current?.kind === "is" ? current.values : [];
  function toggle(value: string) {
    const next = values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
    set(next.length ? { key: question.key, kind: "is", values: next } : null);
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 self-start text-xs text-os-grey hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        All questions
      </button>
      <FilterSectionLabel os>{question.label}</FilterSectionLabel>
      <FilterGroup label="Match responses" os>
        {[question.primary, "answered", "blank"].map((kind) => (
          <FilterPill key={kind} os selected={mode === kind} onClick={() => pickMode(kind as FilterKind)}>
            {MODE_LABELS[kind as FilterKind]}
          </FilterPill>
        ))}
      </FilterGroup>
      {mode === "is" && (
        <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
          {(question.options ?? []).map((o) => (
            <FilterPill key={o.value} os selected={values.includes(o.value)} onClick={() => toggle(o.value)}>
              {o.label}
            </FilterPill>
          ))}
          {(question.options ?? []).length === 0 && (
            <p className="text-xs text-os-grey">This question has no options to pick from.</p>
          )}
        </div>
      )}
      {mode === "contains" && (
        <ContainsControl
          key={question.key}
          filter={current}
          onChange={(text) => set(text.trim() ? { key: question.key, kind: "contains", text: text.trim() } : null)}
        />
      )}
      {mode === "range" && (
        <RangeControl
          key={question.key}
          type={question.type}
          filter={current}
          onChange={({ min, max }) =>
            set(
              min === undefined && max === undefined
                ? null
                : { key: question.key, kind: "range", ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) },
            )
          }
        />
      )}
    </div>
  );
}

export function AnswerFilterButton({ questions }: { questions: FilterableQuestion[] }) {
  const filters = useAnswerFilters(questions);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = questions.find((q) => q.key === selectedKey) ?? null;
  if (questions.length === 0) return null;
  return (
    <Popover
      ariaLabel="Filter by answer"
      panelClassName={filterPanelClass(true)}
      trigger={
        <button type="button" className={customizeButtonClass(true, filters.active.length > 0)}>
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
          Filter
          <FilterCountBadge os count={filters.active.length} />
        </button>
      }
    >
      <div className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto">
        <div className="flex items-center justify-between">
          <FilterSectionLabel os>Filter by answer</FilterSectionLabel>
          {filters.active.length > 0 && <FilterResetButton
              os
              onClick={() => {
                filters.clear();
                setSelectedKey(null);
              }}
            />}
        </div>
        {selected ? (
          <QuestionControls
            key={selected.key}
            question={selected}
            filters={filters}
            onBack={() => setSelectedKey(null)}
          />
        ) : (
          <ul className="flex flex-col">
            {questions.map((q) => (
              <li key={q.key}>
                <button
                  type="button"
                  onClick={() => setSelectedKey(q.key)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-os-card-hover"
                >
                  <span className="truncate">{q.label}</span>
                  {filters.active.some((f) => f.key === q.key) && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-os-accent" aria-label="Filtered" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popover>
  );
}

export function AnswerFilterChips({ questions }: { questions: FilterableQuestion[] }) {
  const filters = useAnswerFilters(questions);
  if (filters.active.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Active answer filters">
      {filters.active.map((f) => {
        const question = questions.find((q) => q.key === f.key);
        if (!question) return null;
        return (
          <li key={f.key} className="max-w-full">
            <FilterPill os selected onClick={() => filters.setFilter(f.key, null)}>
              <span className="inline-flex items-center gap-1.5">
                <span className="sr-only">Remove filter: </span>
                {filterChipText(f, question)}
                <X className="h-3 w-3 shrink-0" aria-hidden />
              </span>
            </FilterPill>
          </li>
        );
      })}
    </ul>
  );
}
