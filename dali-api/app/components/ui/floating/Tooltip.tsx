import { cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from "react";
import {
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
  FloatingPortal,
  type Placement,
} from "@floating-ui/react";

// Hover/focus tooltip (replaces the hand-rolled portal tooltip in IconButton).
// Clones its single child to attach reference props; label is portaled.

export function Tooltip({
  label,
  children,
  placement = "top",
  delay = 200,
}: {
  label: ReactNode;
  children: ReactElement;
  placement?: Placement;
  delay?: number;
}) {
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  const hover = useHover(context, { move: false, delay: { open: delay, close: 0 } });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  const childRef = (children as { ref?: unknown }).ref ?? (children.props as { ref?: unknown }).ref;
  const ref = useMergeRefs([refs.setReference, childRef as never]);
  const trigger = isValidElement(children)
    ? cloneElement(children, {
        ref,
        ...getReferenceProps(children.props as Record<string, unknown>),
      } as Record<string, unknown>)
    : children;

  return (
    <>
      {trigger}
      {open && label != null && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-[70] rounded-md bg-dark-blue px-2 py-1 text-xs font-medium text-white shadow-brand-2"
            {...getFloatingProps()}
          >
            {label}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
