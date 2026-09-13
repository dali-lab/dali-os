import { useEffect, useRef } from "react";
import { useToast } from "~/components/ui/toast";

/**
 * Surface a JSON action/fetcher error as a toast.
 *
 * Actions across the app settle to `Response.json({ error }, { status })` on
 * failure, but many call sites never render that `error` — so a permission
 * denial or a lost race just… does nothing, which reads as a broken button.
 * Drop this next to any `useFetcher()` / `useActionData()` to give those
 * failures a consistent, dismissible surface:
 *
 *   const fetcher = useFetcher<{ error?: string }>();
 *   useActionErrorToast(fetcher.data);
 *
 * Dedupes by result identity — each submission produces a fresh result object,
 * so a retry that returns the *same* message still toasts again, while plain
 * re-renders don't re-fire.
 */
export function useActionErrorToast(
  data: { error?: unknown } | undefined | null,
  opts?: { fallback?: string },
) {
  const toast = useToast();
  const seen = useRef<unknown>(null);
  const fallback = opts?.fallback ?? "Something went wrong. Please try again.";

  useEffect(() => {
    if (!data || data === seen.current) return;
    seen.current = data;
    const err = data.error;
    if (!err) return;
    const message =
      typeof err === "string" && err.trim().length > 0 ? err : fallback;
    toast.error(message);
  }, [data, toast, fallback]);
}
