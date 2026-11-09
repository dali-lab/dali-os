import {
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { Check, ChevronRight } from "lucide-react";
import {
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useListItem,
  useListNavigation,
  useMergeRefs,
  useRole,
  FloatingFocusManager,
  FloatingList,
  FloatingPortal,
} from "@floating-ui/react";
import { OS_MENU_ITEM_CLASS } from "./styles";
import { usePanelClass } from "./os-styles";

// Action menu (the ⋯ / profile / breadcrumb menus, split-button popups). Items
// are callbacks or links. Shared with ContextMenu.tsx via MenuContext so both
// reuse the same Item components and keyboard/ARIA wiring.

type MenuContextValue = {
  activeIndex: number | null;
  getItemProps: (userProps?: Record<string, unknown>) => Record<string, unknown>;
  close: () => void;
};

export const MenuContext = createContext<MenuContextValue | null>(null);

function useMenuContext(who: string) {
  const ctx = useContext(MenuContext);
  if (!ctx) throw new Error(`${who} must be rendered inside <Menu> or <ContextMenu>`);
  return ctx;
}

function MenuRoot({
  trigger,
  children,
  align = "left",
  ariaLabel,
}: {
  /**
   * A single focusable element (usually a <button>) that opens the menu, or a
   * function of the open state (for e.g. rotating a chevron while open).
   */
  trigger: ReactElement | ((open: boolean) => ReactElement);
  children: ReactNode;
  align?: "left" | "right";
  ariaLabel?: string;
}) {
  const panelClass = usePanelClass();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listRef = useRef<Array<HTMLElement | null>>([]);
  const labelsRef = useRef<Array<string | null>>([]);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (o) => {
      setOpen(o);
      if (!o) setActiveIndex(null);
    },
    placement: align === "right" ? "bottom-end" : "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ elements, availableHeight }) {
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.min(availableHeight, 360)}px`,
          });
        },
      }),
    ],
  });

  const click = useClick(context);
  const dismiss = useDismiss(context, { outsidePress: outsidePressExceptSubmenus });
  const role = useRole(context, { role: "menu" });
  const listNav = useListNavigation(context, {
    listRef,
    activeIndex,
    onNavigate: setActiveIndex,
    loop: true,
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    click,
    dismiss,
    role,
    listNav,
  ]);

  const close = useCallback(() => setOpen(false), []);
  const menuValue = useMemo<MenuContextValue>(
    () => ({ activeIndex, getItemProps, close }),
    [activeIndex, getItemProps, close],
  );

  const triggerNode = typeof trigger === "function" ? trigger(open) : trigger;
  const childRef =
    (triggerNode as { ref?: unknown }).ref ?? (triggerNode.props as { ref?: unknown }).ref;
  const triggerRef = useMergeRefs([refs.setReference, childRef as never]);
  const triggerEl = isValidElement(triggerNode)
    ? cloneElement(triggerNode, {
        ref: triggerRef,
        ...getReferenceProps(triggerNode.props as Record<string, unknown>),
      } as Record<string, unknown>)
    : triggerNode;

  return (
    <>
      {triggerEl}
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} closeOnFocusOut={false}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              aria-label={ariaLabel}
              className={`${panelClass} min-w-[10rem]`}
              {...getFloatingProps()}
            >
              <MenuContext.Provider value={menuValue}>
                <FloatingList elementsRef={listRef} labelsRef={labelsRef}>
                  {children}
                </FloatingList>
              </MenuContext.Provider>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}

function itemClass(active: boolean, destructive?: boolean, override?: string) {
  if (override) return override;
  // A destructive row sits on its own pastel red plate (ink and icon in the
  // danger red) so it never reads as one more neutral action.
  if (destructive) {
    return `${OS_MENU_ITEM_CLASS} text-destructive ${
      active ? "bg-destructive/20" : "bg-destructive/10 hover:bg-destructive/20"
    }`;
  }
  return `${OS_MENU_ITEM_CLASS} text-foreground ${active ? "bg-muted" : "hover:bg-muted"}`;
}

export function MenuItem({
  children,
  label,
  icon,
  shortcut,
  checked,
  onSelect,
  disabled,
  destructive,
  className,
}: {
  children: ReactNode;
  /** Type-ahead text; defaults to `children` when it's a string. */
  label?: string;
  icon?: ReactNode;
  /** A muted hint at the row's trailing edge, e.g. the key that does the same thing. */
  shortcut?: string;
  /** Marks the row as the current choice: a check takes the icon's place. */
  checked?: boolean;
  onSelect?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  className?: string;
}) {
  const menu = useMenuContext("<Menu.Item>");
  const item = useListItem({ label: disabled ? null : label ?? (typeof children === "string" ? children : undefined) });
  const active = menu.activeIndex === item.index;
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      ref={item.ref}
      disabled={disabled}
      tabIndex={active ? 0 : -1}
      className={itemClass(active, destructive, className)}
      {...menu.getItemProps({
        onClick: () => {
          if (disabled) return;
          onSelect?.();
          menu.close();
        },
      })}
    >
      {checked ? <Check className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
      {shortcut ? <span className="min-w-0 flex-1">{children}</span> : children}
      {shortcut && <span className="ml-4 shrink-0 text-xs text-muted-foreground">{shortcut}</span>}
    </button>
  );
}

export function MenuLinkItem({
  children,
  to,
  label,
  icon,
  muted,
  className,
  onSelect,
}: {
  children: ReactNode;
  to: string;
  label?: string;
  icon?: ReactNode;
  muted?: boolean;
  className?: string;
  onSelect?: () => void;
}) {
  const menu = useMenuContext("<Menu.LinkItem>");
  const item = useListItem({ label: label ?? (typeof children === "string" ? children : undefined) });
  const active = menu.activeIndex === item.index;
  return (
    <Link
      to={to}
      role="menuitem"
      ref={item.ref}
      tabIndex={active ? 0 : -1}
      className={
        className ??
        `${OS_MENU_ITEM_CLASS} ${muted ? "text-muted-foreground" : "text-foreground"} ${active ? "bg-muted" : "hover:bg-muted"}`
      }
      {...menu.getItemProps({
        onClick: () => {
          onSelect?.();
          menu.close();
        },
      })}
    >
      {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
      {children}
    </Link>
  );
}

const SUB_SELECTOR = "[data-menu-sub]";

/** Keeps a click inside a submenu panel from counting as a click outside the menu that holds it. */
export const outsidePressExceptSubmenus = (event: Event) => !(event.target as Element | null)?.closest?.(SUB_SELECTOR);

/** A row that opens a second panel beside it on hover, click or the right arrow key. */
export function MenuSub({
  label,
  icon,
  disabled,
  children,
}: {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}) {
  const menu = useMenuContext("<Menu.Sub>");
  const panelClass = usePanelClass();
  const item = useListItem({ label: disabled ? null : label });
  const active = menu.activeIndex === item.index;
  const [open, setOpen] = useState(false);
  const listRef = useRef<Array<HTMLElement | null>>([]);
  const labelsRef = useRef<Array<string | null>>([]);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { refs, floatingStyles } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "right-start",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset({ mainAxis: 2, alignmentAxis: -6 }),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ elements, availableHeight }) {
          Object.assign(elements.floating.style, { maxHeight: `${Math.min(availableHeight, 360)}px` });
        },
      }),
    ],
  });
  const subMenu = useMemo<MenuContextValue>(
    () => ({ activeIndex: null, getItemProps: (props) => props ?? {}, close: menu.close }),
    [menu.close],
  );
  const setTrigger = useMergeRefs([item.ref, refs.setReference, triggerRef]);
  const focusRow = (dir: 1 | -1 | "first") => {
    const rows = [...(panelRef.current?.querySelectorAll<HTMLElement>("[role^='menuitem']:not(:disabled)") ?? [])];
    if (rows.length === 0) return;
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next = dir === "first" ? 0 : (at + dir + rows.length) % rows.length;
    rows[next].focus();
  };
  return (
    <div onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        ref={setTrigger}
        disabled={disabled}
        tabIndex={active ? 0 : -1}
        className={itemClass(active || open, false)}
        {...menu.getItemProps({
          onClick: () => setOpen((o) => !o),
          onMouseEnter: () => !disabled && setOpen(true),
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              setOpen(true);
              setTimeout(() => focusRow("first"), 0);
            }
          },
        })}
      >
        {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
        <span className="min-w-0 flex-1">{label}</span>
        <ChevronRight className="ml-4 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={(node) => {
              refs.setFloating(node);
              panelRef.current = node;
            }}
            data-menu-sub
            role="menu"
            aria-label={label}
            style={floatingStyles}
            className={`${panelClass} min-w-[10rem]`}
            onMouseDown={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                e.stopPropagation();
                focusRow(e.key === "ArrowDown" ? 1 : -1);
              } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                triggerRef.current?.focus();
              }
            }}
          >
            <MenuContext.Provider value={subMenu}>
              <FloatingList elementsRef={listRef} labelsRef={labelsRef}>
                {children}
              </FloatingList>
            </MenuContext.Provider>
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}

export function MenuSeparator() {
  return <hr className="my-1 border-border" />;
}

export const Menu = Object.assign(MenuRoot, {
  Item: MenuItem,
  LinkItem: MenuLinkItem,
  Separator: MenuSeparator,
  Sub: MenuSub,
});
