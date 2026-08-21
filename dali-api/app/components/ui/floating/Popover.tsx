import {
  cloneElement,
  isValidElement,
  useCallback,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
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
  useMergeRefs,
  useRole,
  FloatingFocusManager,
  FloatingPortal,
} from "@floating-ui/react";
import { usePanelClass } from "./os-styles";

// Generic anchored popover: a trigger + a portaled panel of ARBITRARY content
// (an emoji grid, a tag list + create form, a filter panel). Owns positioning
// (offset/flip/shift + reposition-on-scroll), outside-click + Escape dismissal,
// and focus management. Use <Select> for a value list and <Menu> for action
// items; this is the primitive for everything that isn't a list of choices.
//
// `children` may be a render-prop receiving `close()` so the panel content can
// dismiss itself after an action (e.g. picking an emoji).

export function Popover({
  trigger,
  children,
  align = "left",
  ariaLabel,
  panelClassName,
}: {
  /** A focusable element (usually a <button>), or a fn of the open state. */
  trigger: ReactElement | ((open: boolean) => ReactElement);
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "left" | "right";
  ariaLabel?: string;
  panelClassName?: string;
}) {
  const panelClass = usePanelClass();
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
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
            maxHeight: `${Math.min(availableHeight, 480)}px`,
          });
        },
      }),
    ],
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "dialog" });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);

  const close = useCallback(() => setOpen(false), []);

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
              className={panelClassName ?? `${panelClass} p-2`}
              {...getFloatingProps()}
            >
              {typeof children === "function" ? children(close) : children}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
