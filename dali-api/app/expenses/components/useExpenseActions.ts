import { useCallback, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import type { ActionResult } from "./types";

export type ExpenseActions = {
  submit: (intent: string, fields?: Record<string, string | null | undefined>) => void;
  busy: boolean;
  pendingIntent: string | null;
  error: string | null;
  result: ActionResult | null;
};

export function useExpenseActions(onDone?: (intent: string, result: ActionResult) => void): ExpenseActions {
  const fetcher = useFetcher<ActionResult>();
  const intent = useRef("");
  const handled = useRef<unknown>(null);
  const callback = useRef(onDone);
  callback.current = onDone;

  const submit = useCallback<ExpenseActions["submit"]>(
    (name, fields = {}) => {
      intent.current = name;
      const form = new FormData();
      form.set("intent", name);
      for (const [k, v] of Object.entries(fields)) if (v !== null && v !== undefined) form.set(k, v);
      fetcher.submit(form, { method: "post", action: "/expenses" });
    },
    [fetcher],
  );

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || handled.current === fetcher.data) return;
    handled.current = fetcher.data;
    callback.current?.(intent.current, fetcher.data);
  }, [fetcher.state, fetcher.data]);

  const result = fetcher.data ?? null;
  return {
    submit,
    busy: fetcher.state !== "idle",
    pendingIntent: fetcher.state !== "idle" ? intent.current : null,
    error: result && !result.ok ? result.error : null,
    result,
  };
}
