import { useRef } from "react";
import { Avatar } from "~/components/ui/Avatar";
import { Combobox, MultiSelect, type MultiSelectOption, type SelectOption } from "~/components/ui/floating";
import { OS_SELECT_TRIGGER_CLASS } from "~/components/ui/floating/styles";
import { cn } from "~/lib/cn";

export type PersonOption = {
  id: string;
  name: string;
  secondary?: string | null;
  photoUrl?: string | null;
};

export function PersonLabel({ name, photoUrl, secondary }: Omit<PersonOption, "id">) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Avatar name={name} photoUrl={photoUrl} size="xs" />
      <span className="min-w-0 truncate">{name}</span>
      {secondary && <span className="min-w-0 truncate text-xs text-muted-foreground">{secondary}</span>}
    </span>
  );
}

export function personOption(p: PersonOption): SelectOption & MultiSelectOption {
  return {
    value: p.id,
    label: p.name,
    description: p.secondary || undefined,
    icon: <Avatar name={p.name} photoUrl={p.photoUrl} size="xs" />,
  };
}

type Common = {
  people: PersonOption[];
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  noMatchesLabel?: string;
};

type Single = Common & {
  mode?: "single";
  value: string | null;
  onChange: (id: string | null) => void;
  /** Keeps the trigger's label when `people` is a search result that no longer holds the pick. */
  selectedPerson?: PersonOption | null;
  /** Fires per keystroke so the caller can fetch `people` from a search. */
  onQueryChange?: (query: string) => void;
  clearLabel?: string;
  /** Off when `people` is already narrowed by the query (a search that matches more than name and secondary text). */
  filterLocally?: boolean;
  autoFocus?: boolean;
  className?: string;
};

type Multi = Common & {
  mode: "multi";
  values: string[];
  onChange: (ids: string[]) => void;
  name?: string;
  searchPlaceholder?: string;
};

export function PersonPicker(props: Single | Multi) {
  if (props.mode === "multi") return <MultiPersonPicker {...props} />;
  return <SinglePersonPicker {...props} />;
}

function MultiPersonPicker({
  people,
  values,
  onChange,
  name,
  ariaLabel,
  placeholder = "Add people",
  searchPlaceholder = "Search people",
  noMatchesLabel = "No people match that search.",
  disabled,
}: Multi) {
  return (
    <MultiSelect
      name={name}
      values={values}
      onChange={onChange}
      options={people.map(personOption)}
      searchable
      disabled={disabled}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      noMatchesLabel={noMatchesLabel}
    />
  );
}

function SinglePersonPicker({
  people,
  value,
  onChange,
  selectedPerson,
  onQueryChange,
  clearLabel,
  filterLocally,
  autoFocus,
  className,
  ariaLabel,
  placeholder = "Search people",
  noMatchesLabel = "No people match that search.",
  disabled,
}: Single) {
  const lastPicked = useRef<PersonOption | null>(null);
  const known = value ? (selectedPerson ?? lastPicked.current) : null;
  const options = people.map(personOption);
  if (value && known && known.id === value && !options.some((o) => o.value === value)) {
    options.unshift(personOption(known));
  }

  return (
    <div className="flex items-center gap-2">
      <Combobox
        value={value ?? ""}
        options={options}
        onChange={(id) => {
          lastPicked.current = people.find((p) => p.id === id) ?? null;
          onChange(id);
        }}
        onQueryChange={onQueryChange}
        filterLocally={filterLocally}
        autoFocus={autoFocus}
        disabled={disabled}
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        emptyLabel={noMatchesLabel}
        className={cn(OS_SELECT_TRIGGER_CLASS, "min-w-0 flex-1", className)}
      />
      {clearLabel && value && !disabled && (
        <button
          type="button"
          onClick={() => {
            lastPicked.current = null;
            onChange(null);
          }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {clearLabel}
        </button>
      )}
    </div>
  );
}
