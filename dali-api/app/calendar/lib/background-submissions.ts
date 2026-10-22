import { useEffect, useRef } from "react";
import { useFetchers } from "react-router";
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

/**
 * Report each background write's outcome once, as soon as its action answers.
 * The answer is read while the fetcher is still revalidating: a fetcher whose
 * component has unmounted is dropped the moment it goes idle.
 */
export function useBackgroundSubmissionToasts(
  onSuccess?: (intent: string, fields: Record<string, string>) => string | null,
) {
  const toast = useToast();
  const fetchers = useFetchers();
  const handled = useRef(new WeakSet<FormData>());
  useEffect(() => {
    for (const f of fetchers) {
      if (!isBackgroundKey(f.key) || !f.formData || f.state === "submitting") continue;
      if (f.data === undefined || handled.current.has(f.formData)) continue;
      handled.current.add(f.formData);
      const intent = String(f.formData.get("intent"));
      const error = (f.data as { error?: unknown } | null)?.error;
      if (error) {
        toast.error(failureMessage(intent, error));
        continue;
      }
      const fields: Record<string, string> = {};
      for (const [k, v] of f.formData.entries()) if (typeof v === "string") fields[k] = v;
      const message = onSuccess?.(intent, fields);
      if (message) toast.success(message);
    }
  }, [fetchers, toast, onSuccess]);
}
