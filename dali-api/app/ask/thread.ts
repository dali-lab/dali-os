import type { AiHistoryEntry } from "~/lib/ai-history";
import type { AskEvent } from "./events";
import type { CitedSource } from "./sources";

export type AskStep = { label: string; done: boolean };

export type AskTurn = {
  id: number;
  question: string;
  steps: AskStep[];
  text: string;
  answer: string | null;
  sources: CitedSource[];
  status: "running" | "done" | "error" | "limited" | "stopped";
  error: string | null;
  retryAt: number | null;
};

export type AskThreadState = { turns: AskTurn[]; remaining: number | null };

export const ASK_HISTORY_TURNS = 6;
export const NEAR_LIMIT = 5;
const GENERIC_ERROR = "Something went wrong.";

export function newTurn(id: number, question: string): AskTurn {
  return { id, question, steps: [], text: "", answer: null, sources: [], status: "running", error: null, retryAt: null };
}

const finishSteps = (steps: AskStep[]) => steps.map((s) => (s.done ? s : { ...s, done: true }));

export function applyAskEvent(turn: AskTurn, event: AskEvent): AskTurn {
  switch (event.type) {
    case "status":
      return { ...turn, steps: [...finishSteps(turn.steps), { label: event.label, done: false }] };
    case "text":
      return { ...turn, steps: finishSteps(turn.steps), text: turn.text + event.delta };
    case "retract":
      return { ...turn, text: "" };
    case "done":
      return {
        ...turn,
        steps: finishSteps(turn.steps),
        text: event.answer,
        answer: event.answer,
        sources: event.sources,
        status: "done",
      };
    case "error":
      return { ...turn, steps: finishSteps(turn.steps), status: "error", error: event.message || GENERIC_ERROR };
    default:
      return turn;
  }
}

/** Earlier answered turns, oldest first, as the alternating history /api/ask accepts. */
export function askHistory(turns: AskTurn[]): AiHistoryEntry[] {
  return turns
    .filter((t) => t.status === "done" && t.answer)
    .slice(-ASK_HISTORY_TURNS)
    .flatMap((t) => [
      { role: "user" as const, content: t.question },
      { role: "assistant" as const, content: t.answer as string },
    ]);
}

/** Splits an SSE buffer into complete `data:` events and the unfinished tail. */
export function parseSseBuffer(buffer: string): { events: AskEvent[]; rest: string } {
  const chunks = buffer.split("\n\n");
  const rest = chunks.pop() ?? "";
  const events: AskEvent[] = [];
  for (const chunk of chunks) {
    const data = chunk
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      events.push(JSON.parse(data) as AskEvent);
    } catch {
      // A malformed event is dropped; the turn still ends on done or error.
    }
  }
  return { events, rest };
}

const QUESTION_START =
  /^(what|who|whom|whose|when|where|why|how|which|did|do|does|is|are|was|were|can|could|should|would|will|has|have|tell me|explain|summari[sz]e|find)\b/i;

/** Whether palette text reads like a question, which puts Ask first. */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (t.length < 4) return false;
  return t.endsWith("?") || (QUESTION_START.test(t) && t.split(/\s+/).length >= 3);
}

type Listener = () => void;

export function createAskThread(deps: { fetch: typeof fetch; now?: () => number }) {
  let state: AskThreadState = { turns: [], remaining: null };
  let nextId = 1;
  let controller: AbortController | null = null;
  const listeners = new Set<Listener>();
  const now = deps.now ?? Date.now;

  const set = (next: AskThreadState) => {
    state = next;
    listeners.forEach((l) => l());
  };
  const updateTurn = (id: number, fn: (t: AskTurn) => AskTurn) =>
    set({ ...state, turns: state.turns.map((t) => (t.id === id ? fn(t) : t)) });

  async function ask(question: string): Promise<void> {
    const q = question.trim();
    if (!q || controller) return;
    const history = askHistory(state.turns);
    const turn = newTurn(nextId++, q);
    set({ ...state, turns: [...state.turns, turn] });
    const ctrl = new AbortController();
    controller = ctrl;
    try {
      const res = await deps.fetch("/api/ask", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history }),
        signal: ctrl.signal,
      });
      if (res.status === 429 && res.headers.get("Retry-After")) {
        const seconds = Number(res.headers.get("Retry-After"));
        const limited = (await res.json().catch(() => ({}))) as { error?: string };
        const isDaily = seconds > 120;
        updateTurn(turn.id, (t) => ({
          ...t,
          status: isDaily ? "limited" : "error",
          error: limited.error ?? GENERIC_ERROR,
          retryAt: isDaily ? now() + seconds * 1000 : null,
        }));
        if (isDaily) set({ ...state, remaining: 0 });
        return;
      }
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        updateTurn(turn.id, (t) => ({ ...t, status: "error", error: body.error ?? GENERIC_ERROR }));
        return;
      }
      const remaining = Number(res.headers.get("X-Ask-Remaining"));
      if (Number.isFinite(remaining) && res.headers.has("X-Ask-Remaining")) set({ ...state, remaining });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseBuffer(buffer);
        buffer = parsed.rest;
        for (const event of parsed.events) updateTurn(turn.id, (t) => applyAskEvent(t, event));
      }
      updateTurn(turn.id, (t) => (t.status === "running" ? { ...t, status: "error", error: GENERIC_ERROR } : t));
    } catch {
      updateTurn(turn.id, (t) =>
        t.status !== "running" ? t : ctrl.signal.aborted ? { ...t, status: "stopped" } : { ...t, status: "error", error: GENERIC_ERROR },
      );
    } finally {
      if (controller === ctrl) controller = null;
    }
  }

  return {
    getState: () => state,
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ask,
    retry(turnId: number) {
      const turn = state.turns.find((t) => t.id === turnId);
      if (!turn || controller) return Promise.resolve();
      set({ ...state, turns: state.turns.filter((t) => t.id !== turnId) });
      return ask(turn.question);
    },
    stop() {
      controller?.abort();
    },
    reset() {
      controller?.abort();
      controller = null;
      set({ turns: [], remaining: state.remaining });
    },
    get busy() {
      return controller !== null;
    },
  };
}

export type AskThread = ReturnType<typeof createAskThread>;

let shared: AskThread | null = null;

/** The one thread for this window. It lives in memory only, so a reload clears it. */
export function sharedAskThread(): AskThread {
  shared ??= createAskThread({ fetch: (...args) => fetch(...args) });
  return shared;
}
