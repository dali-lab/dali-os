import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Settings, type LucideIcon } from "lucide-react";
import { IconButton } from "~/components/ui/IconButton";
import { Menu } from "~/components/ui/floating";
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
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
};

export type PageRowDensity = "full" | "icons" | "menu" | "stacked";

// The design's steps are written in screen widths; the row sits inside the rail
// and page gutters, so they are measured against the row at this offset.
const PAGE_ROW_CHROME = 312;
const FULL_MIN = 1233 - PAGE_ROW_CHROME;
const ICONS_MIN = 1098 - PAGE_ROW_CHROME;
const INLINE_MIN = 900 - PAGE_ROW_CHROME;

export function pageRowDensity(width: number): PageRowDensity {
  if (width >= FULL_MIN) return "full";
  if (width >= ICONS_MIN) return "icons";
  if (width >= INLINE_MIN) return "menu";
  return "stacked";
}

const PageRowControlsTarget = createContext<{
  scoped: boolean;
  target: HTMLElement | null;
  setTarget: (el: HTMLElement | null) => void;
}>({ scoped: false, target: null, setTarget: () => {} });

/** Wraps a page whose tab content hands controls to the row (PageRowControls). */
export function PageRowControlsScope({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  return (
    <PageRowControlsTarget.Provider value={{ scoped: true, target, setTarget }}>
      {children}
    </PageRowControlsTarget.Provider>
  );
}

/** Renders its children into the page row's controls slot, or in place when there is no row. */
export function PageRowControls({ children }: { children: ReactNode }) {
  const { scoped, target } = useContext(PageRowControlsTarget);
  if (!scoped) return <>{children}</>;
  return target ? createPortal(children, target) : null;
}

const CONTROL_BASE =
  "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50";

function ControlButton({
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
        className={cn(
          CONTROL_BASE,
          "ml-1.5 gap-[5px] rounded-full bg-os-accent-fill px-2.5 font-semibold text-os-accent-label hover:opacity-90",
        )}
      >
        <Icon className="h-[13px] w-[13px]" aria-hidden />
        {control.label}
      </button>
    );
  }
  if (iconOnly) {
    return (
      <IconButton
        label={control.label}
        icon={control.icon}
        onClick={control.onClick}
        disabled={control.disabled}
        className="h-7 w-7 p-0 text-os-grey hover:bg-os-hover"
        iconClassName="h-[15px] w-[15px]"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={control.onClick}
      disabled={control.disabled}
      className={cn(CONTROL_BASE, "rounded-md px-2 text-os-grey hover:bg-os-hover hover:text-foreground")}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {control.label}
    </button>
  );
}

export function PageTabRow({
  label,
  tabs,
  controls = [],
  onSettings,
  settingsActive = false,
  className,
}: {
  label: string;
  tabs: SegmentedTab[];
  /** The open tab's own actions; they swap when the tab does. */
  controls?: PageTabControl[];
  /** Shows the gear, pinned far right on every tab, outside the tablist. */
  onSettings?: () => void;
  settingsActive?: boolean;
  className?: string;
}) {
  const [row, setRow] = useState<HTMLDivElement | null>(null);
  const { setTarget } = useContext(PageRowControlsTarget);
  const [density, setDensity] = useState<PageRowDensity>("full");

  useEffect(() => {
    if (!row || typeof ResizeObserver === "undefined") return;
    const apply = (width: number) => {
      if (width > 0) setDensity(pageRowDensity(width));
    };
    apply(row.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => apply(entries[0].contentRect.width));
    observer.observe(row);
    return () => observer.disconnect();
  }, [row]);

  const secondary = controls.filter((c) => !c.primary);
  const primary = controls.filter((c) => c.primary);
  const folded = density === "menu";

  return (
    <div
      ref={setRow}
      data-density={density}
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}
    >
      <SegmentedTabButtons items={tabs} label={label} />
      <div
        className={cn(
          "flex min-w-0 items-center gap-1",
          density === "stacked" ? "order-last w-full justify-start" : "ml-auto",
        )}
      >
        {folded && secondary.length > 0 ? (
          <Menu
            align="right"
            ariaLabel="More actions"
            trigger={
              <button
                type="button"
                aria-label="More actions"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-os-grey transition-colors hover:bg-os-hover hover:text-foreground"
              >
                <MoreHorizontal className="h-[15px] w-[15px]" aria-hidden />
              </button>
            }
          >
            {secondary.map((c) => (
              <Menu.Item
                key={c.key}
                icon={<c.icon className="h-3.5 w-3.5" />}
                disabled={c.disabled}
                onSelect={c.onClick}
              >
                {c.label}
              </Menu.Item>
            ))}
          </Menu>
        ) : (
          secondary.map((c) => (
            <ControlButton key={c.key} control={c} iconOnly={density === "icons"} />
          ))
        )}
        {primary.map((c) => (
          <ControlButton key={c.key} control={c} iconOnly={false} />
        ))}
        <div ref={setTarget} className="flex items-center gap-1 empty:hidden" />
      </div>
      {onSettings && (
        <div className={cn("flex items-center gap-1", density === "stacked" && "ml-auto")}>
          <span aria-hidden className="mx-1 h-[18px] w-px shrink-0 bg-os-container" />
          <IconButton
            label="Settings"
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
