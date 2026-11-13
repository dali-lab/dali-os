import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { PlacedField } from "./certificate-fields";

export type AutosaveStatus = { state: "idle" | "saving" | "saved" | "error"; error?: string };

export const AUTOSAVE_DELAY_MS = 800;
export const SAVE_FIELDS_INTENT = "save-fields";

const SAVE_FAILED = "Could not save changes";

function body(fields: PlacedField[]) {
  return { intent: SAVE_FIELDS_INTENT, fields: JSON.stringify(fields) };
}

export function useCertificateAutosave(fields: PlacedField[], delay = AUTOSAVE_DELAY_MS): AutosaveStatus {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [status, setStatus] = useState<AutosaveStatus>({ state: "idle" });
  const latest = useRef(fields);
  const seen = useRef(fields);
  const dirty = useRef(false);
  const inflight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  latest.current = fields;

  const submit = useRef(fetcher.submit);
  submit.current = fetcher.submit;

  const flush = useCallback(() => {
    if (inflight.current || !dirty.current) return;
    dirty.current = false;
    inflight.current = true;
    void submit.current(body(latest.current), { method: "post" });
  }, []);

  useEffect(() => {
    if (fetcher.state !== "idle" || !inflight.current) return;
    inflight.current = false;
    const data = fetcher.data;
    if (!data?.ok) {
      dirty.current = true;
      setStatus({ state: "error", error: data?.error ?? SAVE_FAILED });
      return;
    }
    if (dirty.current) flush();
    else setStatus({ state: "saved" });
  }, [fetcher.state, fetcher.data, flush]);

  useEffect(() => {
    if (fields === seen.current) return;
    seen.current = fields;
    dirty.current = true;
    setStatus({ state: "saving" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      flush();
    }, delay);
  }, [fields, delay, flush]);

  useEffect(() => {
    const leave = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (!dirty.current) return;
      dirty.current = false;
      void fetch(window.location.pathname, {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
        body: new URLSearchParams(body(latest.current)),
      }).catch(() => {});
    };
    window.addEventListener("beforeunload", leave);
    return () => {
      window.removeEventListener("beforeunload", leave);
      leave();
    };
  }, []);

  return status;
}
