import {
  cloneElement,
  useCallback,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
  FloatingFocusManager,
  FloatingList,
  FloatingPortal,
} from "@floating-ui/react";
import { MenuContext } from "./Menu";
import { PANEL_CLASS } from "./styles";

// Right-click menu anchored to the pointer via a floating-ui virtual element.
// Reuses <Menu.Item>/<Menu.LinkItem> through MenuContext. Clones its single
// child to attach the contextmenu handler (no extra wrapper element).

export function ContextMenu({
  children,
  items,
  ariaLabel,
}: {
  /** The right-clickable target (a single element). */
  children: ReactElement;
  /** Menu body — <Menu.Item> / <Menu.Separator> nodes. */
  items: ReactNode;
  ariaLabel?: string;
}) {
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
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset({ mainAxis: 2 }),
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

  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "menu" });
  const listNav = useListNavigation(context, {
    listRef,
    activeIndex,
    onNavigate: setActiveIndex,
    loop: true,
  });
  const { getFloatingProps, getItemProps } = useInteractions([dismiss, role, listNav]);

  const close = useCallback(() => setOpen(false), []);
  const menuValue = useMemo(
    () => ({ activeIndex, getItemProps, close }),
    [activeIndex, getItemProps, close],
  );

  const openAt = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      refs.setPositionReference({
        getBoundingClientRect() {
          return {
            width: 0,
            height: 0,
            x: e.clientX,
            y: e.clientY,
            top: e.clientY,
            left: e.clientX,
            right: e.clientX,
            bottom: e.clientY,
          };
        },
      });
      setOpen(true);
    },
    [refs],
  );

  const child = cloneElement(children, {
    onContextMenu: (e: ReactMouseEvent) => {
      (children.props as { onContextMenu?: (e: ReactMouseEvent) => void }).onContextMenu?.(e);
      openAt(e);
    },
  } as Record<string, unknown>);

  return (
    <>
      {child}
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              aria-label={ariaLabel}
              className={`${PANEL_CLASS} min-w-[10rem]`}
              {...getFloatingProps()}
            >
              <MenuContext.Provider value={menuValue}>
                <FloatingList elementsRef={listRef} labelsRef={labelsRef}>
                  {items}
                </FloatingList>
              </MenuContext.Provider>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
