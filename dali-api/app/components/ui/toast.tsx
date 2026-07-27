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

/**
 * App-wide toasts — a lightweight, non-blocking replacement for `window.alert`
 * used for transient feedback (errors, confirmations, info):
 *
 *   const toast = useToast();
 *   toast.error("Failed to mark unavailable.");
 *   toast.success("Saved.");
 *
 * Toasts stack bottom-right, auto-dismiss, and can be dismissed manually.
 */

export type ToastVariant = "error" | "success" | "info";

export interface ToastOptions {
  variant?: ToastVariant;
  /** ms until auto-dismiss; 0 keeps it until dismissed manually. */
  duration?: number;
}

interface ToastRecord {
  id: number;
  message: ReactNode;
  variant: ToastVariant;
  duration: number;
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
      message,
      variant: opts?.variant ?? "info",
      duration: opts?.duration ?? DEFAULT_DURATION,
    };
    setToasts((prev) => [...prev, record]);
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
  { Icon: typeof Info; accent: string; role: "alert" | "status" }
> = {
  error: { Icon: AlertTriangle, accent: "text-destructive", role: "alert" },
  success: { Icon: CheckCircle2, accent: "text-accent-teal", role: "status" },
  info: { Icon: Info, accent: "text-accent-coral", role: "status" },
};

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastRecord;
  onDismiss: (id: number) => void;
}) {
  const { Icon, accent, role } = VARIANTS[toast.variant];
  const [shown, setShown] = useState(false);

  useEffect(() => {
    // Next frame: flip to the shown state so the entrance transition runs.
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (toast.duration <= 0) return;
    const timer = setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <div
      role={role}
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-brand-2",
        "transition duration-200 ease-out motion-reduce:transition-none",
        shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
      )}
    >
      <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", accent)} aria-hidden />
      <div className="min-w-0 flex-1 text-sm text-foreground">{toast.message}</div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="-m-1 shrink-0 rounded p-1 text-muted-foreground/70 hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
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
