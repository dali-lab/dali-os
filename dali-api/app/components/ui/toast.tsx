import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "~/lib/cn";
import { OS_SURFACE_CLASS } from "./floating/styles";

/**
 * App-wide toasts — a lightweight, non-blocking replacement for `window.alert`
 * used for transient feedback (errors, confirmations, info):
 *
 *   const toast = useToast();
 *   toast.error("Failed to mark unavailable.");
 *   toast.success("Saved.");
 *
 * Toasts stack bottom-right, auto-dismiss, and can be dismissed manually. A
 * timed toast shows the time left as a shrinking bar and pauses while hovered,
 * focused, or when the tab is hidden (WCAG 2.2.1, Timing Adjustable).
 */

export type ToastVariant = "error" | "success" | "info";

export interface ToastAction {
  label: string;
  /** Runs on click; the toast dismisses itself afterwards. */
  onClick: () => void;
}

export interface ToastOptions {
  variant?: ToastVariant;
  /** ms until auto-dismiss; 0 keeps it until dismissed manually. */
  duration?: number;
  /** Buttons under the message, e.g. Open and Undo. */
  actions?: ToastAction[];
  /** A toast pushed with the id of one already on screen replaces it in place. */
  id?: string;
}

interface ToastRecord {
  id: number;
  key?: string;
  message: ReactNode;
  variant: ToastVariant;
  duration: number;
  actions: ToastAction[];
}

type VariantToastFn = (
  message: ReactNode,
  opts?: Omit<ToastOptions, "variant">,
) => void;

interface ToastApi {
  (message: ReactNode, opts?: ToastOptions): void;
  error: VariantToastFn;
  success: VariantToastFn;
  info: VariantToastFn;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((message: ReactNode, opts?: ToastOptions) => {
    idRef.current += 1;
    const record: ToastRecord = {
      id: idRef.current,
      key: opts?.id,
      message,
      variant: opts?.variant ?? "info",
      duration: opts?.duration ?? DEFAULT_DURATION,
      actions: opts?.actions ?? [],
    };
    setToasts((prev) => {
      const existing = opts?.id ? prev.find((t) => t.key === opts.id) : undefined;
      if (!existing) return [...prev, record];
      return prev.map((t) => (t === existing ? { ...record, id: existing.id } : t));
    });
  }, []);

  const toast = useMemo<ToastApi>(() => {
    const fn = ((message, opts) => push(message, opts)) as ToastApi;
    fn.error = (m, o) => push(m, { ...o, variant: "error" });
    fn.success = (m, o) => push(m, { ...o, variant: "success" });
    fn.info = (m, o) => push(m, { ...o, variant: "info" });
    return fn;
  }, [push]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-end gap-2 p-4 sm:p-6">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

const VARIANTS: Record<
  ToastVariant,
  { Icon: typeof Info; accent: string; bar: string; role: "alert" | "status" }
> = {
  error: { Icon: AlertTriangle, accent: "text-destructive", bar: "bg-destructive", role: "alert" },
  success: { Icon: CheckCircle2, accent: "text-os-green", bar: "bg-os-green", role: "status" },
  info: { Icon: Info, accent: "text-os-accent", bar: "bg-os-accent", role: "status" },
};

function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "hidden",
  );
  useEffect(() => {
    const update = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return hidden;
}

/**
 * Dismisses after `duration` ms of unpaused time. Pausing clears the timer and
 * banks the elapsed part, so resuming waits only for what is left.
 */
function useDismissTimer(
  duration: number,
  paused: boolean,
  onElapsed: () => void,
) {
  const remainingRef = useRef(duration);
  useEffect(() => {
    remainingRef.current = duration;
  }, [duration]);
  useEffect(() => {
    if (duration <= 0 || paused) return;
    const startedAt = Date.now();
    const timer = setTimeout(onElapsed, remainingRef.current);
    return () => {
      clearTimeout(timer);
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt));
    };
  }, [duration, paused, onElapsed]);
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastRecord;
  onDismiss: (id: number) => void;
}) {
  const { Icon, accent, bar, role } = VARIANTS[toast.variant];
  const [shown, setShown] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const hidden = useDocumentHidden();
  const paused = hovered || focused || hidden;
  const timed = toast.duration > 0;

  useEffect(() => {
    // Next frame: flip to the shown state so the entrance transition runs.
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const dismissSelf = useCallback(() => onDismiss(toast.id), [onDismiss, toast.id]);
  useDismissTimer(toast.duration, paused, dismissSelf);

  return (
    <div
      role={role}
      data-paused={timed && paused ? "" : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      className={cn(
        OS_SURFACE_CLASS,
        "pointer-events-auto relative flex w-full max-w-sm items-start gap-3 overflow-hidden p-3.5",
        "transition duration-200 ease-out motion-reduce:transition-none",
        shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
      )}
    >
      <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", accent)} aria-hidden />
      <div className="min-w-0 flex-1 text-sm text-foreground">
        {toast.message}
        {toast.actions.length > 0 && (
          <div className="mt-2 flex gap-3">
            {toast.actions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => {
                  action.onClick();
                  onDismiss(toast.id);
                }}
                className="font-medium text-os-accent underline-offset-2 hover:underline"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="-m-1 shrink-0 rounded p-1 text-muted-foreground/70 hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
      {timed && (
        <div
          aria-hidden
          data-toast-timer
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left animate-toast-timer motion-reduce:hidden",
            bar,
          )}
          style={{
            animationDuration: `${toast.duration}ms`,
            animationPlayState: paused ? "paused" : "running",
          }}
        />
      )}
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
