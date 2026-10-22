import { useCallback, useContext, useEffect, useId, useRef } from "react";
import { UNSAFE_DataRouterContext, useSubmit } from "react-router";
import { useToast } from "~/components/ui/toast";

/**
 * Writes the user has already walked away from: the form that sent them closed
 * on submit, so nothing on screen is left to show a failure. Their fetcher keys
 * carry this prefix so the calendar page can report the outcome for them.
 */
const BACKGROUND_PREFIX = "cal:bg:";

export const backgroundKey = (name: string, id: string) => `${BACKGROUND_PREFIX}${name}:${id}`;
export const isBackgroundKey = (key: string) => key.startsWith(BACKGROUND_PREFIX);

const FAILURE_LEAD: Record<string, string> = {
  "event-move": "Couldn't move the event.",
  "event-update": "Couldn't save the event.",
  "event-delete": "Couldn't delete the event.",
  "event-create": "Couldn't create the event.",
  "add-time-entry": "Couldn't add the timesheet entry.",
  "update-time-entry": "Couldn't save the timesheet entry.",
  "delete-time-entry": "Couldn't delete the timesheet entry.",
};

export function failureMessage(intent: string, error: unknown): string {
  const lead = FAILURE_LEAD[intent] ?? "Couldn't save that change.";
  return typeof error === "string" && error.trim() ? `${lead} ${error}` : lead;
}

/** The intent a background key was built for: `cal:bg:<intent>:<id>`. */
export const intentOfKey = (key: string) => key.slice(BACKGROUND_PREFIX.length).split(":")[0] ?? "";

/**
 * Send a write the caller is about to walk away from. It goes through
 * `useSubmit` with a fetcher key rather than a component-owned `useFetcher`:
 * a keyed fetcher is dropped the moment its component unmounts and it is idle,
 * which would swallow the failure before the page could report it.
 */
export function useSubmitBackground() {
  const submit = useSubmit();
  const instanceId = useId();
  return useCallback(
    (intent: string, payload: FormData | Record<string, string>, opts: { action?: string; id?: string } = {}) =>
      submit(payload, {
        method: "post",
        action: opts.action,
        fetcherKey: backgroundKey(intent, opts.id ?? instanceId),
        navigate: false,
      }),
    [submit, instanceId],
  );
}

/**
 * Report each background write's outcome once, from the router's own state
 * stream. A failed action answers with a 4xx/5xx, which skips revalidation: the
 * fetcher goes loading, then idle within microtasks, and React renders only the
 * idle state. An idle fetcher that nothing has mounted is then removed from the
 * map `useFetchers` reads, so no render ever sees the answer. Subscribing sees
 * every state, before that removal.
 */
export function useBackgroundSubmissionToasts(
  onSuccess?: (intent: string, fields: Record<string, string>) => string | null,
) {
  const toast = useToast();
  const router = useContext(UNSAFE_DataRouterContext)?.router;
  const latest = useRef({ toast, onSuccess });
  latest.current = { toast, onSuccess };
  useEffect(() => {
    if (!router) return;
    const handled = new WeakSet<object>();
    const forms = new Map<string, FormData>();
    return router.subscribe((state) => {
      state.fetchers.forEach((f, key) => {
        if (!isBackgroundKey(key)) return;
        if (f.formData) forms.set(key, f.formData);
        if (f.state === "submitting" || f.data == null || typeof f.data !== "object" || handled.has(f.data)) return;
        handled.add(f.data);
        const formData = f.formData ?? forms.get(key);
        forms.delete(key);
        const intent = intentOfKey(key);
        const error = (f.data as { error?: unknown }).error;
        if (error) {
          latest.current.toast.error(failureMessage(intent, error));
          return;
        }
        const fields: Record<string, string> = {};
        if (formData) for (const [k, v] of formData.entries()) if (typeof v === "string") fields[k] = v;
        const message = latest.current.onSuccess?.(intent, fields);
        if (message) latest.current.toast.success(message);
      });
    });
  }, [router]);
}
