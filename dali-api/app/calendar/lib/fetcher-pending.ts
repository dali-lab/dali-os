import { useEffect } from "react";
import { useToast } from "~/components/ui/toast";

type FetcherLike = { state: string; formData?: FormData; json?: unknown; data?: unknown };

const errorOf = (fetcher: FetcherLike) => (fetcher.data as { error?: string } | null | undefined)?.error;

/** The form a fetcher is still carrying out, or undefined once it is idle or its
 *  action answered with an error (the optimistic state snaps back). */
export function pendingForm(fetcher: FetcherLike): FormData | undefined {
  if (fetcher.state === "idle" || !fetcher.formData || errorOf(fetcher)) return undefined;
  return fetcher.formData;
}

/** The JSON body a fetcher is still carrying out, under the same rule as `pendingForm`. */
export function pendingJson<T>(fetcher: FetcherLike): T | undefined {
  if (fetcher.state === "idle" || fetcher.json == null || errorOf(fetcher)) return undefined;
  return fetcher.json as T;
}

/** Toasts the error an action answers with. */
export function useFetcherErrorToast(fetcher: FetcherLike) {
  const toast = useToast();
  const error = errorOf(fetcher);
  useEffect(() => {
    if (error) toast.error(error);
  }, [fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
}
