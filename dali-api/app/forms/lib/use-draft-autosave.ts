import { useCallback, useEffect, useRef, useState } from "react";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

export const AUTOSAVE_DELAY_MS = 1000;

export function useDraftAutosave<T>({
  send,
  busy,
  result,
  serialize,
  baseline,
  delay = AUTOSAVE_DELAY_MS,
}: {
  send: (payload: T) => void;
  busy: boolean;
  result: { ok?: boolean } | undefined;
  serialize: (payload: T) => string;
  baseline: T;
  delay?: number;
}) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const lastSaved = useRef<string>(serialize(baseline));
  const pending = useRef<T | null>(null);
  const sending = useRef<T | null>(null);
  const failed = useRef<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waiters = useRef<Array<() => void>>([]);
  const resultRef = useRef(result);
  resultRef.current = result;
  const sendRef = useRef(send);
  sendRef.current = send;
  const serializeRef = useRef(serialize);
  serializeRef.current = serialize;

  const notifyIfIdle = useCallback(() => {
    if (sending.current || pending.current) return;
    const done = waiters.current;
    waiters.current = [];
    done.forEach((resolve) => resolve());
  }, []);

  const sendNext = useCallback(() => {
    if (sending.current || !pending.current) {
      notifyIfIdle();
      return;
    }
    const payload = pending.current;
    pending.current = null;
    if (serializeRef.current(payload) === lastSaved.current) {
      notifyIfIdle();
      return;
    }
    sending.current = payload;
    resultAtSend.current = resultRef.current;
    setStatus("saving");
    sendRef.current(payload);
  }, [notifyIfIdle]);

  const schedule = useCallback(
    (payload: T) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (!pending.current && !sending.current && serializeRef.current(payload) === lastSaved.current) {
        return;
      }
      pending.current = payload;
      timer.current = setTimeout(() => {
        timer.current = null;
        sendNext();
      }, delay);
    },
    [delay, sendNext],
  );

  const flush = useCallback((): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    return new Promise<void>((resolve) => {
      waiters.current.push(resolve);
      sendNext();
    });
  }, [sendNext]);

  const retry = useCallback(() => {
    if (!pending.current && failed.current) pending.current = failed.current;
    failed.current = null;
    sendNext();
  }, [sendNext]);

  const reset = useCallback(
    (next: T) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      pending.current = null;
      failed.current = null;
      lastSaved.current = serializeRef.current(next);
      setStatus("idle");
      notifyIfIdle();
    },
    [notifyIfIdle],
  );

  const wasBusy = useRef(false);
  const resultAtSend = useRef(result);
  useEffect(() => {
    const answered = wasBusy.current || result !== resultAtSend.current;
    if (!busy && answered && sending.current) {
      const payload = sending.current;
      sending.current = null;
      if (result?.ok) {
        lastSaved.current = serializeRef.current(payload);
        failed.current = null;
        setStatus(pending.current ? "saving" : "saved");
        if (!timer.current) sendNext();
      } else {
        failed.current = pending.current ?? payload;
        pending.current = null;
        setStatus("error");
        notifyIfIdle();
      }
    }
    wasBusy.current = busy;
  }, [busy, result, sendNext, notifyIfIdle]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const onPageHide = () => void flush();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      void flush();
    };
  }, [flush]);

  return { status, schedule, flush, retry, reset };
}
