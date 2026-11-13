import { useCallback, useEffect, useRef, useState } from "react";
import type { PlacedField } from "./certificate-fields";

export type AutosaveStatus = { state: "idle" | "saving" | "saved" | "error"; error?: string };

export const AUTOSAVE_DELAY_MS = 800;

function request(fields: PlacedField[], keepalive: boolean) {
  return fetch(window.location.pathname, {
    method: "POST",
    credentials: "same-origin",
    keepalive,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ intent: "save-fields", fields: JSON.stringify(fields) }).toString(),
  });
}

export function useCertificateAutosave(fields: PlacedField[], delay = AUTOSAVE_DELAY_MS): AutosaveStatus {
  const [status, setStatus] = useState<AutosaveStatus>({ state: "idle" });
  const latest = useRef(fields);
  const seen = useRef(fields);
  const dirty = useRef(false);
  const inflight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  latest.current = fields;

  const flush = useCallback(async () => {
    if (inflight.current || !dirty.current) return;
    dirty.current = false;
    inflight.current = true;
    let next: AutosaveStatus;
    try {
      const res = await request(latest.current, false);
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      next = res.ok && body.ok ? { state: "saved" } : { state: "error", error: body.error ?? "Could not save changes" };
    } catch {
      next = { state: "error", error: "Could not save changes" };
    }
    inflight.current = false;
    if (next.state === "error") dirty.current = true;
    else if (dirty.current) return flush();
    if (mounted.current) setStatus(next);
  }, []);

  useEffect(() => {
    if (fields === seen.current) return;
    seen.current = fields;
    dirty.current = true;
    setStatus({ state: "saving" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void flush();
    }, delay);
  }, [fields, delay, flush]);

  useEffect(() => {
    mounted.current = true;
    const leave = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (!dirty.current) return;
      dirty.current = false;
      void request(latest.current, true).catch(() => {});
    };
    window.addEventListener("beforeunload", leave);
    return () => {
      window.removeEventListener("beforeunload", leave);
      mounted.current = false;
      leave();
    };
  }, []);

  return status;
}
