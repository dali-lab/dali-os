import { Check, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Button } from "~/components/ui/Button";
import { AnchoredCard } from "~/components/ui/floating/AnchoredCard";
import { OS_SURFACE_CLASS } from "~/components/ui/floating/styles";
import { cn } from "~/lib/cn";
import { TONES } from "../kinds";

export function useTriggerAnchor<T extends HTMLElement>(open: unknown) {
  const ref = useRef<T | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    setAnchor(open ? (ref.current?.getBoundingClientRect() ?? null) : null);
  }, [open]);
  return { ref, anchor };
}

export function EditPopover({
  anchor,
  onClose,
  ariaLabel,
  excludeRef,
  compact = false,
  onKeyDown,
  children,
}: {
  anchor: DOMRect | null;
  onClose: () => void;
  ariaLabel: string;
  excludeRef?: RefObject<HTMLElement | null>;
  compact?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  return (
    <AnchoredCard
      anchor={anchor}
      onClose={onClose}
      ariaLabel={ariaLabel}
      excludeRef={excludeRef}
      placement="bottom-start"
      className={cn(OS_SURFACE_CLASS, "os-form max-w-[calc(100vw-32px)] text-sm text-foreground", compact ? "p-2" : "w-72 p-3")}
    >
      <div className={cn("flex", compact ? "gap-1.5" : "flex-col gap-2.5")} onKeyDown={onKeyDown}>
        {children}
      </div>
    </AnchoredCard>
  );
}

export function PopoverActions({
  deleteLabel,
  onDelete,
  saveLabel,
  onSave,
}: {
  deleteLabel: string;
  onDelete: () => void;
  saveLabel: string;
  onSave: () => void;
}) {
  return (
    <div className="-mx-3 -mb-3 mt-0.5 flex items-center justify-between border-t border-os-container px-3 py-2">
      <Button variant="ghost" size="xs" className="text-destructive hover:text-destructive" onClick={onDelete}>
        <Trash2 size={12} strokeWidth={1.5} aria-hidden />
        {deleteLabel}
      </Button>
      <Button size="xs" onClick={onSave}>
        {saveLabel}
      </Button>
    </div>
  );
}

export function PopoverError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="-mt-1 text-xs text-destructive">
      {children}
    </p>
  );
}

export function ToneSwatches({
  label,
  value,
  onPick,
}: {
  label: string;
  value: string;
  onPick: (tone: string) => void;
}) {
  return (
    <div className="dali-cmp-chip-pop__colors" role="radiogroup" aria-label={label}>
      {TONES.map((tn) => (
        <button
          key={tn}
          type="button"
          role="radio"
          aria-checked={value === tn}
          aria-label={tn}
          title={tn}
          onClick={() => onPick(tn)}
          className={`dali-cmp-swatch dali-cmp-swatch--pick dali-cmp-tone--${tn}`}
        >
          {value === tn && <Check className="dali-cmp-ico dali-cmp-ico--check" size={9} strokeWidth={2.25} aria-hidden />}
        </button>
      ))}
    </div>
  );
}
