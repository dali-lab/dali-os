import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { Slide } from "./types";

export type DeckSaveState = "saved" | "unsaved" | "saving" | "conflict" | "error";

type SaveResponse = { ok: true; version: string } | { ok: false; status: number; error: string };

const SAVE_DELAY_MS = 800;

/**
 * The editor's working copy of a deck. Edits apply at once and save after a
 * short pause; each save names the version it started from so the server can
 * refuse it if someone else saved in between.
 */
export function useDeckAutosave(initial: Slide[], initialVersion: string) {
  const [slides, setSlides] = useState(initial);
  const [state, setState] = useState<DeckSaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const fetcher = useFetcher<SaveResponse>();
  const version = useRef(initialVersion);
  const latest = useRef(slides);
  latest.current = slides;
  // The slides as of the last save sent, to tell whether edits landed during it.
  const sent = useRef<Slide[] | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const save = useCallback(() => {
    window.clearTimeout(timer.current);
    sent.current = latest.current;
    setState("saving");
    fetcher.submit({ intent: "save", slides: latest.current, version: version.current } as never, {
      method: "post",
      encType: "application/json",
    });
  }, [fetcher]);

  const edit = useCallback((fn: (s: Slide[]) => Slide[]) => {
    setSlides((s) => fn(s));
    setState((s) => (s === "conflict" ? s : "unsaved"));
  }, []);

  useEffect(() => {
    if (state !== "unsaved" || fetcher.state !== "idle") return;
    timer.current = window.setTimeout(save, SAVE_DELAY_MS);
    return () => window.clearTimeout(timer.current);
  }, [state, slides, fetcher.state, save]);

  useEffect(() => {
    const res = fetcher.data;
    if (fetcher.state !== "idle" || !res) return;
    if (res.ok) {
      version.current = res.version;
      setError(null);
      setState(sent.current === latest.current ? "saved" : "unsaved");
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

  return { slides, edit, state, error, retry: save };
}
