import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown, MoreHorizontal, Search, Settings, type LucideIcon } from "lucide-react";
import { IconButton } from "~/components/ui/IconButton";
import { Menu, Popover } from "~/components/ui/floating";
import { SearchInput } from "~/components/ui/SearchInput";
import { SegmentedTabButtons, type SegmentedTab } from "~/components/ui/SegmentedTabs";
import { cn } from "~/lib/cn";

// The parts a dali.os hub page is built from — the hero's labelled clusters,
// the page row (the island, the open tab's controls and the settings gear) under it, and the hairlined facts card its sections state their
// details in. Shared by the project detail page and the member profile so the
// two read as one page shape rather than two that drift.

// The dali.os "facts list": a card whose rows are an icon/label on the left and
// the value on the right, hairlined between. The project page's Project details
// and the member profile's Personal both wear it, in read and edit mode, so the
// two pages state a fact the same way.

/** The card the rows sit in. Rows supply their own hairline. */
export const OS_DETAIL_CARD = "rounded-os-card bg-os-card px-5";

/** Sizing for the glyph a row's label carries. */
export const OS_DETAIL_ICON = "h-[17px] w-[17px] text-os-grey";

// One label/value row: a muted label with its glyph on the left, the value
// right-aligned.
export function DetailRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-os-container py-3 last:border-0">
      <span className="flex items-center gap-2.5 text-sm text-os-grey">
        {icon}
        {label}
      </span>
      <div className="min-w-0 text-right text-sm text-foreground">{children}</div>
    </div>
  );
}

/* The same row, with a field where the value was. When inside a
   grid grid-cols-[max-content_1fr] container, col-span-2 + subgrid makes every
   row share the same column tracks — the label column auto-sizes to the widest
   label in the card, so all inputs start at the same X. */
export function DetailEditRow({
  icon,
  label,
  infoTip,
  children,
}: {
  icon: ReactNode;
  label: string;
  infoTip?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="col-span-2 grid grid-cols-subgrid items-center gap-x-6 border-b border-os-container py-3 last:border-0">
      <span className="flex shrink-0 items-center gap-2.5 text-sm text-os-grey whitespace-nowrap">
        {icon}
        {label}
        {infoTip}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** The label a hero cluster wears (Terms, Roles) above its chips. */
export function HeroClusterLabel({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-os-grey">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}


export type PageTabControl = {
  kind?: "button";
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  pressed?: boolean;
};

export type PageToggleControl = {
  kind: "toggle";
  key: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; icon: LucideIcon; testId?: string }[];
};

export type PageSearchControl = {
  kind: "search";
  key: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId?: string;
};

export type PageMenuItem = {
  key: string;
  label: string;
  icon?: LucideIcon;
  onSelect?: () => void;
  disabled?: boolean;
  items?: PageMenuItem[];
};

export type PageMenuControl = {
  kind: "menu";
  key: string;
  label: string;
  icon: LucideIcon;
  items: PageMenuItem[];
  disabled?: boolean;
  primary?: boolean;
};

export type PageCustomControl = {
  kind: "custom";
  key: string;
  label: string;
  icon: LucideIcon;
  render: () => ReactNode;
};

export type PageRowControl =
  | PageTabControl
  | PageToggleControl
  | PageSearchControl
  | PageMenuControl
  | PageCustomControl;

export type PageRowDensity = "full" | "icons" | "menu" | "stacked";

const DENSITY_ORDER = ["full", "icons", "menu"] as const;
const ROW_GAP = 12;

const RegisterContext = createContext<{
  scoped: boolean;
  register: (owner: string, controls: PageRowControl[] | null) => void;
}>({ scoped: false, register: () => {} });
const RegisteredControlsContext = createContext<PageRowControl[]>([]);

/** Wraps a page whose tab content hands controls to the row (PageRowControls). */
export function PageRowControlsScope({ children }: { children: ReactNode }) {
  const owners = useRef(new Map<string, PageRowControl[]>());
  const [list, setList] = useState<PageRowControl[]>([]);
  const register = useCallback((owner: string, controls: PageRowControl[] | null) => {
    if (controls) owners.current.set(owner, controls);
    else owners.current.delete(owner);
    setList([...owners.current.values()].flat());
  }, []);
  const api = useMemo(() => ({ scoped: true, register }), [register]);
  return (
    <RegisterContext.Provider value={api}>
      <RegisteredControlsContext.Provider value={list}>{children}</RegisteredControlsContext.Provider>
    </RegisterContext.Provider>
  );
}

/** True when a page row is listening, so a tab renders its controls there instead of in its own toolbar. */
export function usePageRowScoped() {
  return useContext(RegisterContext).scoped;
}

/** Puts these controls in the page row; renders nothing itself. */
export function PageRowControls({ controls }: { controls: PageRowControl[] }) {
  const { scoped, register } = useContext(RegisterContext);
  const owner = useId();
  useEffect(() => {
    if (scoped) register(owner, controls);
  });
  useEffect(() => {
    if (!scoped) return;
    return () => register(owner, null);
  }, [scoped, owner, register]);
  return null;
}

const CONTROL_BASE =
  "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50";
export const PAGE_ROW_PRIMARY_CLASS =
  "ml-1.5 gap-[5px] rounded-full bg-os-accent-fill px-2.5 font-semibold text-os-accent-label hover:opacity-90";
const GLYPH_CLASS =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-os-grey transition-colors hover:bg-os-hover hover:text-foreground";
const DIVIDER = <span aria-hidden className="mx-1 h-[18px] w-px shrink-0 bg-os-container" />;

/** One row button: the primary pill, a labeled secondary, or an icon-only one. */
export function PageRowButton({
  control,
  iconOnly,
}: {
  control: PageTabControl;
  iconOnly: boolean;
}) {
  const Icon = control.icon;
  if (control.primary) {
    return (
      <button
        type="button"
        onClick={control.onClick}
        disabled={control.disabled}
        className={cn(CONTROL_BASE, PAGE_ROW_PRIMARY_CLASS)}
      >
        <Icon className="h-[13px] w-[13px]" aria-hidden />
        {control.label}
      </button>
    );
  }
  const pressed = control.pressed ? "bg-os-hover-strong text-foreground" : "text-os-grey hover:bg-os-hover";
  if (iconOnly) {
    return (
      <IconButton
        label={control.label}
        icon={control.icon}
        onClick={control.onClick}
        disabled={control.disabled}
        aria-pressed={control.pressed}
        className={cn("h-7 w-7 p-0", pressed)}
        iconClassName="h-[15px] w-[15px]"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={control.onClick}
      disabled={control.disabled}
      aria-pressed={control.pressed}
      className={cn(CONTROL_BASE, "rounded-md px-2 hover:text-foreground", pressed)}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {control.label}
    </button>
  );
}

function ToggleButtons({ control }: { control: PageToggleControl }) {
  return (
    <div role="group" aria-label={control.label} className="inline-flex shrink-0 items-center gap-0.5">
      {control.options.map((o) => (
        <IconButton
          key={o.value}
          label={o.label}
          icon={o.icon}
          data-testid={o.testId}
          aria-pressed={control.value === o.value}
          onClick={() => control.onChange(o.value)}
          className={cn(
            "h-7 w-7 p-0",
            control.value === o.value ? "bg-os-hover-strong text-foreground" : "text-os-grey hover:bg-os-hover",
          )}
          iconClassName="h-[15px] w-[15px]"
        />
      ))}
    </div>
  );
}

function RowSearch({ control, collapsed }: { control: PageSearchControl; collapsed: boolean }) {
  const field = (autoFocus: boolean) => (
    <SearchInput
      size="xs"
      autoFocus={autoFocus}
      value={control.value}
      onChange={(e) => control.onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") control.onChange("");
      }}
      placeholder={control.label}
      aria-label={control.label}
      data-testid={control.testId}
      containerClassName={autoFocus ? "w-56" : "w-40 shrink-0"}
    />
  );
  if (!collapsed) return field(false);
  return (
    <Popover
      align="right"
      ariaLabel={control.label}
      trigger={
        <button
          type="button"
          aria-label={control.label}
          className={cn(GLYPH_CLASS, control.value && "bg-os-hover-strong text-foreground")}
        >
          <Search className="h-[15px] w-[15px]" aria-hidden />
        </button>
      }
    >
      {field(true)}
    </Popover>
  );
}

function RowCustom({ control, collapsed }: { control: PageCustomControl; collapsed: boolean }) {
  if (!collapsed) return <>{control.render()}</>;
  const Icon = control.icon;
  return (
    <Popover
      align="right"
      ariaLabel={control.label}
      trigger={
        <button type="button" aria-label={control.label} className={GLYPH_CLASS}>
          <Icon className="h-[15px] w-[15px]" aria-hidden />
        </button>
      }
    >
      {control.render()}
    </Popover>
  );
}

function MenuEntries({ items }: { items: PageMenuItem[] }) {
  return (
    <>
      {items.map((item) => {
        const icon = item.icon ? <item.icon className="h-3.5 w-3.5" /> : undefined;
        return item.items ? (
          <Menu.Sub key={item.key} label={item.label} icon={icon} disabled={item.disabled}>
            <MenuEntries items={item.items} />
          </Menu.Sub>
        ) : (
          <Menu.Item key={item.key} icon={icon} disabled={item.disabled} onSelect={item.onSelect ?? (() => {})}>
            {item.label}
          </Menu.Item>
        );
      })}
    </>
  );
}

function RowMenu({ control, iconOnly }: { control: PageMenuControl; iconOnly: boolean }) {
  const Icon = control.icon;
  const trigger = control.primary ? (
    <button type="button" disabled={control.disabled} className={cn(CONTROL_BASE, PAGE_ROW_PRIMARY_CLASS)}>
      <Icon className="h-[13px] w-[13px]" aria-hidden />
      {control.label}
      <ChevronDown className="h-3 w-3 opacity-80" aria-hidden />
    </button>
  ) : iconOnly ? (
    <button type="button" aria-label={control.label} disabled={control.disabled} className={GLYPH_CLASS}>
      <Icon className="h-[15px] w-[15px]" aria-hidden />
    </button>
  ) : (
    <button
      type="button"
      disabled={control.disabled}
      className={cn(CONTROL_BASE, "rounded-md px-2 text-os-grey hover:bg-os-hover hover:text-foreground")}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {control.label}
      <ChevronDown className="h-3 w-3 opacity-80" aria-hidden />
    </button>
  );
  return (
    <Menu align="right" ariaLabel={control.label} trigger={trigger}>
      <MenuEntries items={control.items} />
    </Menu>
  );
}

function isPrimary(c: PageRowControl) {
  return (c.kind === undefined || c.kind === "button" || c.kind === "menu") && !!c.primary;
}

function ControlsCluster({ controls, density }: { controls: PageRowControl[]; density: PageRowDensity }) {
  const folded = density === "menu";
  const iconOnly = density === "icons";
  const out: ReactNode[] = [];
  const foldedEntries: ReactNode[] = [];

  controls.forEach((c, i) => {
    if (isPrimary(c)) return;
    if (c.kind === "custom") {
      out.push(<RowCustom key={c.key} control={c} collapsed={folded} />);
    } else if (c.kind === "search") {
      out.push(<RowSearch key={c.key} control={c} collapsed={folded} />);
    } else if (folded && c.kind === "toggle") {
      foldedEntries.push(
        ...c.options.map((o) => (
          <Menu.Item
            key={`${c.key}-${o.value}`}
            icon={<o.icon className="h-3.5 w-3.5" />}
            checked={c.value === o.value}
            onSelect={() => c.onChange(o.value)}
          >
            {o.label}
          </Menu.Item>
        )),
      );
    } else if (c.kind === "toggle") {
      if (i > 0) out.push(<span key={`${c.key}-divider`}>{DIVIDER}</span>);
      out.push(<ToggleButtons key={c.key} control={c} />);
    } else if (folded && c.kind === "menu") {
      foldedEntries.push(
        <Menu.Sub key={c.key} label={c.label} icon={<c.icon className="h-3.5 w-3.5" />} disabled={c.disabled}>
          <MenuEntries items={c.items} />
        </Menu.Sub>,
      );
    } else if (c.kind === "menu") {
      out.push(<RowMenu key={c.key} control={c} iconOnly={iconOnly} />);
    } else if (folded && (c.kind === undefined || c.kind === "button")) {
      foldedEntries.push(
        <Menu.Item
          key={c.key}
          icon={<c.icon className="h-3.5 w-3.5" />}
          disabled={c.disabled}
          checked={c.pressed}
          onSelect={c.onClick}
        >
          {c.label}
        </Menu.Item>,
      );
    } else if (c.kind === undefined || c.kind === "button") {
      out.push(<PageRowButton key={c.key} control={c} iconOnly={iconOnly} />);
    }
  });

  if (foldedEntries.length > 0) {
    out.push(
      <Menu
        key="more"
        align="right"
        ariaLabel="More actions"
        trigger={
          <button type="button" aria-label="More actions" className={GLYPH_CLASS}>
            <MoreHorizontal className="h-[15px] w-[15px]" aria-hidden />
          </button>
        }
      >
        {foldedEntries}
      </Menu>,
    );
  }

  controls.forEach((c) => {
    if (!isPrimary(c)) return;
    out.push(
      c.kind === "menu" ? (
        <RowMenu key={c.key} control={c} iconOnly={false} />
      ) : (
        <PageRowButton key={c.key} control={c as PageTabControl} iconOnly={false} />
      ),
    );
  });
  return <>{out}</>;
}

function controlsSignature(controls: PageRowControl[]) {
  return controls
    .map((c) => {
      const kind = c.kind ?? "button";
      const extra = c.kind === "toggle" ? c.options.map((o) => o.label).join(",") : "primary" in c ? c.primary : "";
      return `${kind}:${c.key}:${c.label}:${extra}`;
    })
    .join("|");
}

export function PageTabRow({
  label,
  tabs,
  controls = [],
  onSettings,
  settingsActive = false,
  settingsLabel = "Settings",
  className,
}: {
  label: string;
  tabs: SegmentedTab[];
  /** The open tab's own actions; they swap when the tab does. */
  controls?: PageRowControl[];
  /** Shows the gear, pinned far right on every tab, outside the tablist. */
  onSettings?: () => void;
  settingsActive?: boolean;
  settingsLabel?: string;
  className?: string;
}) {
  const [row, setRow] = useState<HTMLDivElement | null>(null);
  const [rowWidth, setRowWidth] = useState(0);
  const [density, setDensity] = useState<PageRowDensity>("full");
  const islandRef = useRef<HTMLDivElement>(null);
  const clusterRef = useRef<HTMLDivElement>(null);
  const gearRef = useRef<HTMLDivElement>(null);
  const widths = useRef<Partial<Record<PageRowDensity, number>>>({});
  const measuredFor = useRef("");
  const registered = useContext(RegisteredControlsContext);
  const all = useMemo(() => [...controls, ...registered], [controls, registered]);
  const signature = controlsSignature(all);

  useEffect(() => {
    if (!row || typeof ResizeObserver === "undefined") return;
    setRowWidth(row.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => setRowWidth(entries[0].contentRect.width));
    observer.observe(row);
    return () => observer.disconnect();
  }, [row]);

  const hasGear = !!onSettings;
  useLayoutEffect(() => {
    if (measuredFor.current !== signature) {
      measuredFor.current = signature;
      widths.current = {};
    }
    if (rowWidth <= 0 || all.length === 0) {
      if (density !== "full") setDensity("full");
      return;
    }
    if (density !== "stacked") {
      widths.current[density] = clusterRef.current?.getBoundingClientRect().width ?? 0;
    }
    const island = islandRef.current?.getBoundingClientRect().width ?? 0;
    const gear = hasGear ? (gearRef.current?.getBoundingClientRect().width ?? 0) : 0;
    const available = rowWidth - island - gear - ROW_GAP * (hasGear ? 2 : 1);
    for (const step of DENSITY_ORDER) {
      const width = widths.current[step];
      if (width === undefined || width <= available) {
        if (density !== step) setDensity(step);
        return;
      }
    }
    if (density !== "stacked") setDensity("stacked");
  }, [rowWidth, signature, density, hasGear, all.length]);

  return (
    <div
      ref={setRow}
      data-density={density}
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}
    >
      {tabs.length > 0 && (
        <div ref={islandRef} data-slot="island" className="shrink-0">
          <SegmentedTabButtons items={tabs} label={label} />
        </div>
      )}
      <div
        ref={clusterRef}
        data-slot="controls"
        className={cn(
          "flex items-center gap-1",
          density === "stacked" ? "order-last w-full justify-start" : "ml-auto shrink-0",
        )}
      >
        <ControlsCluster controls={all} density={density} />
      </div>
      {onSettings && (
        <div
          ref={gearRef}
          data-slot="gear"
          className={cn("flex items-center gap-1", density === "stacked" && "ml-auto")}
        >
          {DIVIDER}
          <IconButton
            label={settingsLabel}
            icon={Settings}
            onClick={onSettings}
            aria-pressed={settingsActive}
            className={cn(
              "h-7 w-7 p-0 text-os-grey hover:bg-os-hover",
              settingsActive && "bg-os-hover-strong text-foreground",
            )}
            iconClassName="h-[15px] w-[15px]"
          />
        </div>
      )}
    </div>
  );
}
