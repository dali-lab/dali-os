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
import { MENU_ITEM_CLASS } from "./styles";
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
  const dismiss = useDismiss(context);
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
          <FloatingFocusManager context={context} modal={false}>
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
  return `${MENU_ITEM_CLASS} ${destructive ? "text-red-600" : ""} ${active ? "bg-muted" : "hover:bg-muted"}`;
}

export function MenuItem({
  children,
  label,
  icon,
  onSelect,
  disabled,
  destructive,
  className,
}: {
  children: ReactNode;
  /** Type-ahead text; defaults to `children` when it's a string. */
  label?: string;
  icon?: ReactNode;
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
      role="menuitem"
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
      {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
      {children}
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
        `${MENU_ITEM_CLASS} ${muted ? "text-muted-foreground" : "text-foreground"} ${active ? "bg-muted" : "hover:bg-muted"}`
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

export function MenuSeparator() {
  return <hr className="my-1 border-border" />;
}

export const Menu = Object.assign(MenuRoot, {
  Item: MenuItem,
  LinkItem: MenuLinkItem,
  Separator: MenuSeparator,
});
