import { useCallback, useEffect, useRef, useState } from "react";
import type { ConsoleEntry, LabFiles, LabStep } from "~/journeys/lib/types";
import { buildLabDocument, LAB_MESSAGE_SOURCE } from "~/journeys/lib/lab-runtime";

type LabMessage =
  | { source: string; runId: number; type: "console"; level: ConsoleEntry["level"]; text: string }
  | { source: string; runId: number; type: "checks"; results: Record<string, boolean> };

function isLabMessage(data: unknown): data is LabMessage {
  return typeof data === "object" && data !== null && (data as { source?: unknown }).source === LAB_MESSAGE_SOURCE;
}

const MAX_LOGS = 300;
const LEVELS = new Set(["log", "info", "warn", "error"]);

/** Runs lab files in a visible preview plus a hidden check page, re-running as files change. */
export function useLabRuntime(files: LabFiles, steps: LabStep[]) {
  const [previewDoc, setPreviewDoc] = useState("");
  const [testDoc, setTestDoc] = useState("");
  const [logs, setLogs] = useState<ConsoleEntry[]>([]);
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState(true);
  const runIdRef = useRef(0);
  const logIdRef = useRef(0);
  const previewRef = useRef<HTMLIFrameElement | null>(null);
  const checkRef = useRef<HTMLIFrameElement | null>(null);

  const run = useCallback((current: LabFiles, currentSteps: LabStep[]) => {
    const id = runIdRef.current + 1;
    runIdRef.current = id;
    setLogs([]);
    setChecking(true);
    setPreviewDoc(buildLabDocument(current, { runId: id, mode: "preview" }));
    setTestDoc(buildLabDocument(current, { runId: id, mode: "test", steps: currentSteps }));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => run(files, steps), 450);
    return () => window.clearTimeout(timer);
  }, [files, steps, run]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isLabMessage(event.data) || event.data.runId !== runIdRef.current) return;
      const msg = event.data;
      // The sandboxed frames are opaque-origin, so origin can't identify them;
      // their window objects can. Console lines only come from the preview and
      // check results only from the check frame.
      const fromPreview = event.source !== null && event.source === previewRef.current?.contentWindow;
      const fromCheck = event.source !== null && event.source === checkRef.current?.contentWindow;
      if (msg.type === "console" && fromPreview) {
        if (!LEVELS.has(msg.level) || typeof msg.text !== "string") return;
        logIdRef.current += 1;
        const entry: ConsoleEntry = { id: logIdRef.current, level: msg.level, text: msg.text };
        setLogs((prev) => [...prev, entry].slice(-MAX_LOGS));
      } else if (msg.type === "checks" && fromCheck) {
        const clean: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(msg.results ?? {})) clean[k] = v === true;
        setResults(clean);
        setChecking(false);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const rerun = useCallback(() => run(files, steps), [run, files, steps]);
  const clearLogs = useCallback(() => setLogs([]), []);

  return { previewDoc, testDoc, logs, results, checking, rerun, clearLogs, previewRef, checkRef };
}

export type LabRuntime = ReturnType<typeof useLabRuntime>;
