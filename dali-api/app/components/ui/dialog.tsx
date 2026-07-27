import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "~/components/Modal";
import { buttonClasses } from "~/components/ui/Button";

/**
 * App-wide confirm/prompt dialogs — a styled, accessible, dark-mode-aware
 * replacement for native `window.confirm` / `window.prompt`. The API is
 * promise-based so call sites read like the native ones they replace:
 *
 *   const dialog = useDialog();
 *   if (!(await dialog.confirm({ title: "Delete file?", tone: "destructive" }))) return;
 *   const name = await dialog.prompt({ title: "New folder", label: "Folder name" });
 *
 * The dialog stays "dumb": it resolves and closes immediately. Any async work
 * (fetcher submit, network) stays with the caller and keeps its own pending UI,
 * exactly matching native `confirm()` semantics.
 */

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `destructive` renders the confirm button in brand red and shows a warning icon. */
  tone?: "default" | "destructive";
  /** Override the leading icon (defaults to a warning triangle for destructive). */
  icon?: ReactNode;
}

export interface PromptOptions {
  title: string;
  description?: ReactNode;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Return an error message to block submission, or null to allow it. */
  validate?: (value: string) => string | null;
}

export interface DialogApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
}

const DialogContext = createContext<DialogApi | null>(null);

type ActiveDialog =
  | { kind: "confirm"; opts: ConfirmOptions }
  | { kind: "prompt"; opts: PromptOptions };

export function DialogProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveDialog | null>(null);
  const resolverRef = useRef<((value: boolean | string | null) => void) | null>(
    null,
  );

  const settle = useCallback((value: boolean | string | null) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setActive(null);
    resolve?.(value);
  }, []);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        // A dialog already open? Resolve it as cancelled before replacing it.
        resolverRef.current?.(false);
        resolverRef.current = resolve as (v: boolean | string | null) => void;
        setActive({ kind: "confirm", opts });
      }),
    [],
  );

  const prompt = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        resolverRef.current?.(null);
        resolverRef.current = resolve as (v: boolean | string | null) => void;
        setActive({ kind: "prompt", opts });
      }),
    [],
  );

  const value = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);

  return (
    <DialogContext.Provider value={value}>
      {children}
      {active?.kind === "confirm" && (
        <ConfirmDialogView
          opts={active.opts}
          onCancel={() => settle(false)}
          onConfirm={() => settle(true)}
        />
      )}
      {active?.kind === "prompt" && (
        <PromptDialogView
          opts={active.opts}
          onCancel={() => settle(null)}
          onConfirm={(v) => settle(v)}
        />
      )}
    </DialogContext.Provider>
  );
}

function ConfirmDialogView({
  opts,
  onCancel,
  onConfirm,
}: {
  opts: ConfirmOptions;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const destructive = opts.tone === "destructive";
  // Non-destructive: focus the primary button so Enter confirms (like native
  // confirm). Destructive: leave focus on Cancel (first focusable) so an
  // accidental Enter doesn't delete anything.
  const confirmRef = useRef<HTMLButtonElement>(null);
  const icon =
    opts.icon ??
    (destructive ? (
      <AlertTriangle
        className="w-5 h-5 text-destructive shrink-0 mt-0.5"
        aria-hidden
      />
    ) : null);

  return (
    <Modal
      open
      onClose={onCancel}
      labelledBy={titleId}
      initialFocusRef={destructive ? undefined : confirmRef}
    >
      <div className="flex items-start gap-3">
        {icon}
        <div className="min-w-0 flex-1">
          <h2
            id={titleId}
            className="font-heading text-lg font-bold text-foreground"
          >
            {opts.title}
          </h2>
          {opts.description && (
            <div className="mt-1 text-sm text-muted-foreground">
              {opts.description}
            </div>
          )}
        </div>
      </div>
      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className={buttonClasses("secondary")}
        >
          {opts.cancelLabel ?? "Cancel"}
        </button>
        <button
          ref={confirmRef}
          type="button"
          onClick={onConfirm}
          className={buttonClasses(destructive ? "destructive" : "primary")}
        >
          {opts.confirmLabel ?? "Confirm"}
        </button>
      </div>
    </Modal>
  );
}

function PromptDialogView({
  opts,
  onCancel,
  onConfirm,
}: {
  opts: PromptOptions;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(opts.defaultValue ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const err = opts.validate?.(value) ?? null;
    if (err) {
      setError(err);
      return;
    }
    onConfirm(value);
  };

  return (
    <Modal open onClose={onCancel} labelledBy={titleId} initialFocusRef={inputRef}>
      <form onSubmit={submit}>
        <h2
          id={titleId}
          className="font-heading text-lg font-bold text-foreground"
        >
          {opts.title}
        </h2>
        {opts.description && (
          <p className="mt-1 text-sm text-muted-foreground">{opts.description}</p>
        )}
        <label className="mt-4 block">
          {opts.label && (
            <span className="mb-1 block text-sm font-medium text-foreground">
              {opts.label}
            </span>
          )}
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            placeholder={opts.placeholder}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral/30 focus-visible:ring-offset-2"
          />
        </label>
        {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className={buttonClasses("secondary")}
          >
            {opts.cancelLabel ?? "Cancel"}
          </button>
          <button type="submit" className={buttonClasses("primary")}>
            {opts.confirmLabel ?? "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error("useDialog must be used within a DialogProvider");
  }
  return ctx;
}

/**
 * Guard a `<form>` / RR `<Form>` submission behind a confirm dialog. Returns a
 * factory so it is safe to call inside `.map()`:
 *
 *   const confirmSubmit = useConfirmSubmit();
 *   <Form onSubmit={confirmSubmit({ title: "Delete group?", tone: "destructive" })}>
 *
 * On first submit it blocks and opens the dialog; on confirm it re-submits the
 * same form (armed via a WeakSet so the second pass falls straight through to
 * the fetcher/router submission).
 */
export function useConfirmSubmit() {
  const { confirm } = useDialog();
  const armedRef = useRef<WeakSet<HTMLFormElement>>(new WeakSet());

  return useCallback(
    (opts: ConfirmOptions) =>
      async (e: React.FormEvent<HTMLFormElement>) => {
        const form = e.currentTarget;
        if (armedRef.current.has(form)) {
          armedRef.current.delete(form);
          return; // second pass: let the real submission proceed
        }
        e.preventDefault();
        if (await confirm(opts)) {
          armedRef.current.add(form);
          form.requestSubmit();
        }
      },
    [confirm],
  );
}
