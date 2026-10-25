import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { Journey, JourneyContent } from "~/journeys/lib/types";

export type SaveState = "saved" | "unsaved" | "saving" | "conflict" | "error";

type SaveResponse = { ok: true; intent: string; version?: string } | { ok: false; status: number; error: string };

const SAVE_DELAY_MS = 800;

function contentOf({ id: _id, ...rest }: Journey): JourneyContent {
  return rest;
}

/**
 * The editor's working copy of a draft. Edits apply locally at once and are
 * saved after a short pause; each save carries the version it was based on so
 * the server can refuse it if someone else saved in between.
 */
export function useDraftAutosave(initial: Journey, initialVersion: string) {
  const [draft, setDraft] = useState(initial);
  const [state, setState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const fetcher = useFetcher<SaveResponse>();
  const version = useRef(initialVersion);
  const latest = useRef(draft);
  latest.current = draft;
  // The draft as of the last save sent, to tell whether edits landed during it.
  const sentRef = useRef<Journey | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [inFlight, setInFlight] = useState<"save" | "publish" | null>(null);
  const [published, setPublished] = useState(0);

  const send = useCallback(
    (intent: "save" | "publish") => {
      window.clearTimeout(timer.current);
      sentRef.current = latest.current;
      setInFlight(intent);
      setState("saving");
      fetcher.submit(
        { intent, draft: contentOf(latest.current), version: version.current } as never,
        { method: "post", encType: "application/json" },
      );
    },
    [fetcher],
  );

  const edit = useCallback((fn: (j: Journey) => Journey) => {
    setDraft((d) => fn(d));
    setState((s) => (s === "conflict" ? s : "unsaved"));
  }, []);

  useEffect(() => {
    if (state !== "unsaved" || fetcher.state !== "idle") return;
    timer.current = window.setTimeout(() => send("save"), SAVE_DELAY_MS);
    return () => window.clearTimeout(timer.current);
  }, [state, draft, fetcher.state, send]);

  useEffect(() => {
    const res = fetcher.data;
    if (fetcher.state !== "idle" || !res) return;
    setInFlight(null);
    if (res.ok) {
      if (res.version) version.current = res.version;
      if (res.intent === "publish") setPublished((n) => n + 1);
      setError(null);
      setState(sentRef.current === latest.current ? "saved" : "unsaved");
    } else {
      setError(res.error);
      setState(res.status === 409 ? "conflict" : "error");
    }
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (state === "saved") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);

  return {
    draft,
    edit,
    state,
    error,
    /** Saves any pending edits and publishes them, in one request. */
    publish: () => send("publish"),
    retry: () => send("save"),
    publishing: inFlight === "publish",
    /** Bumps after each successful publish. */
    published,
  };
}
