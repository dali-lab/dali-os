import { PANEL_CSS } from "./panel-styles";
import { sendToWorker } from "./messages";
import type {
  StatusReply,
  PairStartReply,
  PairPollReply,
  PullReply,
  SignOutReply,
} from "./messages";
import type { TimesheetExport, FillOutcome, LoggedEntry } from "./types";
import { prepareRow, commitRow, canFill, classify, findSavedRowDelete, type EntryStatus } from "./jobx";
import { formatHours, totalHours } from "./overlap";
import { DEFAULT_LOOKBACK_DAYS } from "./config";

/** An entry's [start, end] as minutes since midnight, for totalling. */
function entryMinutes(entry: LoggedEntry): [number, number] {
  const mins = (iso: string) => {
    const d = new Date(iso);
    return d.getHours() * 60 + d.getMinutes();
  };
  return [mins(entry.startAt), mins(entry.endAt)];
}

// A fill that must survive JobX's full-page reload after each saved row. We
// persist remaining entries to chrome.storage.local; after every reload the
// freshly re-injected panel reads this and fills the next entry, until done.
// A "replace" item is filled in two page loads: delete the old row, then (after
// the reload) add the new one. `deleted` records that the delete step is done.
interface FillItem {
  entry: LoggedEntry;
  replace: boolean;
  deleted: boolean;
}
interface FillQueue {
  items: FillItem[];
  results: FillOutcome[];
  next: number;
  total: number;
  hireLabel: string;
  startedAt: number;
  active: boolean;
}
const QUEUE_KEY = "fill_queue";
const QUEUE_MAX_AGE_MS = 5 * 60_000;

async function getQueue(): Promise<FillQueue | null> {
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  const queue = stored[QUEUE_KEY] as FillQueue | undefined;
  if (!queue) return null;
  if (Date.now() - queue.startedAt > QUEUE_MAX_AGE_MS) {
    await chrome.storage.local.remove(QUEUE_KEY);
    return null;
  }
  return queue;
}
const setQueue = (queue: FillQueue) => chrome.storage.local.set({ [QUEUE_KEY]: queue });
const removeQueue = () => chrome.storage.local.remove(QUEUE_KEY);

type State =
  | { screen: "loading" }
  | { screen: "disconnected"; error?: string }
  | { screen: "pairing"; code: string; message?: string }
  | { screen: "ready"; busy?: boolean; error?: string }
  | { screen: "pulled"; data: TimesheetExport; statuses: EntryStatus[]; switching?: boolean; error?: string }
  | { screen: "filling"; done: number; total: number }
  | { screen: "done"; results: FillOutcome[]; hireLabel: string };

// Tiny hyperscript so the rest reads declaratively without a framework.
type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, unknown>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = String(value);
    else if (key === "value") (node as unknown as { value: string }).value = String(value);
    else if (key === "onclick") node.addEventListener("click", value as EventListener);
    else if (key === "onchange") node.addEventListener("change", value as EventListener);
    else if (key === "oninput") node.addEventListener("input", value as EventListener);
    else if (key === "onmousedown") node.addEventListener("mousedown", value as EventListener);
    else if (value != null && value !== false) node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// A time <input> gives "HH:MM"; keep the entry's original calendar day and just
// move the local clock time. Blank/invalid input leaves the value untouched.
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const withTime = (iso: string, value: string): string => {
  const [hh, mm] = value.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return iso;
  const d = new Date(iso);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
};

export class Panel {
  private host: HTMLElement;
  private mount: HTMLElement;
  private state: State = { screen: "loading" };
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private dragOffset: { x: number; y: number } | null = null;

  constructor() {
    this.host = h("div", { id: "dali-timesheet-panel-host" });
    const root = this.host.attachShadow({ mode: "open" });
    this.mount = h("div");
    root.append(h("style", {}, PANEL_CSS), this.mount);
    document.documentElement.appendChild(this.host);
    void this.init();
  }

  get hidden(): boolean {
    return this.host.style.display === "none";
  }
  toggle(): void {
    this.host.style.display = this.hidden ? "" : "none";
  }

  // Drag the panel by its header. The host is right-anchored to start; on the
  // first drag we switch to left/top so it can move freely, clamped to the
  // viewport. Document-level listeners keep tracking even if the pointer
  // outruns the header.
  private startDrag(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest(".close")) return; // let close click through
    e.preventDefault();
    const rect = this.host.getBoundingClientRect();
    this.host.style.left = `${rect.left}px`;
    this.host.style.top = `${rect.top}px`;
    this.host.style.right = "auto";
    this.dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const move = (ev: MouseEvent) => this.onDrag(ev);
    const up = () => {
      this.dragOffset = null;
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  private onDrag(e: MouseEvent): void {
    if (!this.dragOffset) return;
    const maxX = Math.max(4, window.innerWidth - this.host.offsetWidth - 4);
    const maxY = Math.max(4, window.innerHeight - this.host.offsetHeight - 4);
    const x = Math.min(Math.max(4, e.clientX - this.dragOffset.x), maxX);
    const y = Math.min(Math.max(4, e.clientY - this.dragOffset.y), maxY);
    this.host.style.left = `${x}px`;
    this.host.style.top = `${y}px`;
  }

  private async init(): Promise<void> {
    // A fill in progress (resumed after JobX reloaded the page) takes priority.
    const queue = await getQueue();
    if (queue && queue.active) {
      this.set({ screen: "filling", done: queue.next, total: queue.total });
      void this.drive();
      return;
    }
    const status = await sendToWorker<StatusReply>({ kind: "status" });
    this.set(status.paired ? { screen: "ready" } : { screen: "disconnected" });
  }

  private set(state: State): void {
    this.state = state;
    this.render();
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  private async connect(): Promise<void> {
    const reply = await sendToWorker<PairStartReply>({ kind: "pair-start" });
    if (!reply.ok) {
      this.set({ screen: "disconnected", error: reply.error });
      return;
    }
    this.set({ screen: "pairing", code: reply.userCode, message: "Approve in the DALI OS tab that just opened." });
    this.pollTimer = setInterval(() => void this.pollPairing(), 3000);
  }

  private async pollPairing(): Promise<void> {
    const reply = await sendToWorker<PairPollReply>({ kind: "pair-poll" });
    if (reply.status === "pending") return;
    this.stopPolling();
    if (reply.status === "approved") {
      this.set({ screen: "ready" });
    } else {
      const message =
        reply.status === "denied" ? "Pairing was declined." :
        reply.status === "expired" ? "The pairing code expired." :
        reply.message ?? "Pairing failed.";
      this.set({ screen: "disconnected", error: message });
    }
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private async pull(hire?: string): Promise<void> {
    if (this.state.screen === "ready") this.set({ screen: "ready", busy: true });
    else if (this.state.screen === "pulled") this.set({ ...this.state, switching: true });

    const to = new Date();
    const from = new Date(to.getTime() - DEFAULT_LOOKBACK_DAYS * 86_400_000);
    const reply = await sendToWorker<PullReply>({
      kind: "pull",
      from: isoDay(from),
      to: isoDay(to),
      hire,
    });

    if (reply.ok) {
      // Compare against rows already saved on the JobX page (only meaningful on
      // a timesheet page; elsewhere everything reads as new).
      const statuses = canFill() ? classify(reply.data.entries) : reply.data.entries.map(() => "new" as const);
      this.set({ screen: "pulled", data: reply.data, statuses });
    } else if (reply.code === "auth") {
      this.set({ screen: "disconnected", error: reply.message });
    } else {
      this.set({ screen: "ready", error: reply.message });
    }
  }

  private async startFill(): Promise<void> {
    if (this.state.screen !== "pulled") return;
    const { data, statuses } = this.state;
    // Skip "added" (already in JobX); "new" is added; "override" is deleted then
    // re-added. Fields already reflect only this hire's entries, so it stays
    // role-scoped.
    const items: FillItem[] = data.entries
      .map((entry, i) => ({ entry, status: statuses[i] ?? "new" }))
      .filter((x) => x.status !== "added")
      .map((x) => ({ entry: x.entry, replace: x.status === "override", deleted: false }));
    if (items.length === 0) return;
    await setQueue({
      items,
      results: [],
      next: 0,
      total: items.length,
      hireLabel: data.hireLabel,
      startedAt: Date.now(),
      active: true,
    });
    this.set({ screen: "filling", done: 0, total: items.length });
    void this.drive();
  }

  // Process one item at a time across JobX's reloads. Each action that commits
  // (delete or add) reloads the page; the re-injected panel calls drive() again
  // via init(). A "replace" item takes two passes: delete the old row, then (on
  // the reload) add the new one. Non-navigating outcomes continue in this tick.
  private async drive(): Promise<void> {
    const queue = await getQueue();
    if (!queue || !queue.active) return;

    if (queue.next >= queue.total) {
      await removeQueue();
      this.set({ screen: "done", results: queue.results, hireLabel: queue.hireLabel });
      return;
    }
    if (!canFill()) {
      this.set({ screen: "filling", done: queue.next, total: queue.total });
      return;
    }

    while (queue.next < queue.total) {
      const item = queue.items[queue.next];
      const dateLabel = fmtDate(item.entry.startAt);
      this.set({ screen: "filling", done: queue.next, total: queue.total });

      // Phase 1: delete the old row for a replace, then wait for the reload.
      if (item.replace && !item.deleted) {
        const found = findSavedRowDelete(item.entry);
        if (found.ok) {
          item.deleted = true;
          await setQueue(queue); // persist before the delete navigates
          found.el.click(); // → reload → resume this item in the add phase
          return;
        }
        // Nothing to delete after all: if it's simply gone, fall through to add;
        // if ambiguous/error, record and skip.
        if (found.status === "skipped") {
          item.deleted = true; // treat as already-removed; proceed to add
        } else {
          queue.results.push({ date: dateLabel, status: found.status, detail: found.detail });
          queue.next += 1;
          await setQueue(queue);
          continue;
        }
      }

      // Phase 2: add the entry (new, or replace after its delete).
      const prep = prepareRow(item.entry);
      queue.results.push(
        prep.ok
          ? { date: dateLabel, status: "filled" }
          : { date: dateLabel, status: prep.status, detail: prep.detail },
      );
      queue.next += 1;
      if (prep.ok) {
        await setQueue(queue); // persist before the Add navigates
        commitRow(prep.prefix, prep.suffix); // → reload → resumes next item
        return;
      }
      await setQueue(queue); // skipped/error: no reload, continue
    }

    await removeQueue();
    this.set({ screen: "done", results: queue.results, hireLabel: queue.hireLabel });
  }

  private async signOut(): Promise<void> {
    await sendToWorker<SignOutReply>({ kind: "sign-out" });
    this.set({ screen: "disconnected" });
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  private render(): void {
    this.mount.replaceChildren(
      h(
        "div",
        { class: "card" },
        this.header(),
        this.body(),
        this.footer(),
      ),
    );
  }

  private header(): HTMLElement {
    return h(
      "div",
      { class: "head", onmousedown: (e: MouseEvent) => this.startDrag(e) },
      h("span", { class: "mark" }, "D"),
      h("h1", {}, "DALI Timesheet"),
      h("button", { class: "close", title: "Hide", onclick: () => this.toggle() }, "×"),
    );
  }

  private footer(): HTMLElement | null {
    const canSignOut =
      this.state.screen === "ready" || this.state.screen === "pulled" || this.state.screen === "done";
    if (!canSignOut) return null;
    return h(
      "div",
      { class: "foot" },
      h("span", { class: "muted" }, "Connected to DALI OS"),
      h("button", { class: "link", onclick: () => void this.signOut() }, "Disconnect"),
    );
  }

  private body(): HTMLElement {
    const body = h("div", { class: "body" });
    const s = this.state;
    switch (s.screen) {
      case "loading":
        body.append(h("div", { class: "center" }, h("span", { class: "spin" })));
        break;

      case "disconnected":
        body.append(
          h("h2", { class: "sec" }, "Connect your account"),
          h("p", { class: "muted" }, "Approve once in DALI OS to pull the hours you've logged — no separate password."),
          ...(s.error ? [h("div", { class: "err" }, s.error)] : []),
          h("button", { class: "btn block", onclick: () => void this.connect() }, "Connect DALI OS"),
        );
        break;

      case "pairing":
        body.append(
          h("h2", { class: "sec" }, "Enter this code in DALI OS"),
          h("div", { class: "code" }, s.code),
          h("div", { class: "center" }, h("span", { class: "spin" }), h("p", { class: "muted" }, s.message ?? "Waiting for approval…")),
        );
        break;

      case "ready":
        body.append(
          h("h2", { class: "sec" }, "Pull your logged hours"),
          h("p", { class: "muted" }, `Fetches the last ${DEFAULT_LOOKBACK_DAYS} days from your DALI OS timesheet.`),
          ...(s.error ? [h("div", { class: "err" }, s.error)] : []),
          h(
            "button",
            { class: "btn block", onclick: () => void this.pull(), ...(s.busy ? { disabled: "true" } : {}) },
            s.busy ? "Pulling…" : "Pull my hours",
          ),
        );
        break;

      case "pulled":
        body.append(this.pulledView(s.data, s.statuses, s.switching, s.error));
        break;

      case "filling":
        body.append(
          h(
            "div",
            { class: "center" },
            h("span", { class: "spin" }),
            h(
              "p",
              { class: "muted" },
              s.total ? `Filling ${Math.min(s.done + 1, s.total)} of ${s.total}…` : "Filling…",
            ),
          ),
        );
        break;

      case "done":
        body.append(this.doneView(s.results, s.hireLabel));
        break;
    }
    return body;
  }

  private pulledView(
    data: TimesheetExport,
    statuses: EntryStatus[],
    switching?: boolean,
    error?: string,
  ): DocumentFragment {
    const frag = document.createDocumentFragment();

    // Role picker — the fill only ever touches the selected role's timesheet.
    // Always rendered when there's more than one hire, even if the others have
    // no hours in this window: hiding it meant a member with a second job
    // couldn't reach it from here at all.
    if (data.availableHires.length > 1) {
      const select = h(
        "select",
        {
          onchange: (e: Event) => void this.pull((e.target as HTMLSelectElement).value),
        },
        ...data.availableHires.map((hire) =>
          h("option", { value: hire.key, ...(hire.key === data.hireKey ? { selected: "true" } : {}) }, hire.label),
        ),
      );
      frag.append(h("label", { class: "field" }, "Role / job", select));
    } else {
      frag.append(h("h2", { class: "sec" }, data.hireLabel));
    }

    if (error) frag.append(h("div", { class: "err" }, error));

    const newCount = statuses.filter((s) => s === "new").length;
    const addedCount = statuses.filter((s) => s === "added").length;
    const overrideCount = statuses.filter((s) => s === "override").length;

    // Hours for the whole pulled window, so the member can reconcile against
    // what payroll expects without adding the rows up by hand. Counts only
    // what isn't already in JobX, with the full figure alongside when some of
    // it has been filed already.
    const ranges = data.entries.map(entryMinutes);
    const periodTotal = totalHours(ranges);
    const outstandingTotal = totalHours(ranges.filter((_, i) => statuses[i] !== "added"));

    frag.append(
      h(
        "div",
        { class: "row" },
        h("span", { class: "pill" }, `${data.entries.length} ${data.entries.length === 1 ? "entry" : "entries"}`),
        h(
          "span",
          { class: "pill total", title: `${formatHours(periodTotal)} logged in DALI OS for this window` },
          formatHours(periodTotal),
        ),
        switching ? h("span", { class: "spin" }) : h("span", { class: "muted" }, `→ ${data.hireLabel}`),
        h("button", { class: "link refresh", onclick: () => void this.pull(data.hireKey) }, "Refresh"),
      ),
    );

    if (outstandingTotal > 0 && outstandingTotal !== periodTotal) {
      frag.append(
        h("p", { class: "muted" }, `${formatHours(outstandingTotal)} still to add to JobX.`),
      );
    }

    if (addedCount || overrideCount) {
      const parts: string[] = [];
      if (addedCount) parts.push(`${addedCount} already in JobX`);
      if (overrideCount) parts.push(`${overrideCount} will replace existing`);
      frag.append(h("p", { class: "muted" }, parts.join(" · ")));
    }

    // Entries are editable in place before filling: adjust the start/end time or
    // the note and the change is used by the fill. Fields are uncontrolled so
    // typing never re-renders (which would drop focus). A status tag marks rows
    // already saved in JobX (skipped) or that differ from a saved row.
    const list = h(
      "div",
      { class: "list" },
      ...data.entries.map((entry, i) => {
        const status = statuses[i] ?? "new";
        return h(
          "div",
          { class: status === "added" ? "entry is-added" : "entry" },
          h(
            "div",
            { class: "entry-head" },
            h("span", { class: "date" }, fmtDate(entry.startAt)),
            status === "added"
              ? h("span", { class: "tag added" }, "Added")
              : status === "override"
                ? h("span", { class: "tag warn" }, "Replaces existing")
                : null,
          ),
          h(
            "div",
            { class: "entry-times" },
            h("input", {
              type: "time",
              class: "t",
              value: hhmm(entry.startAt),
              onchange: (e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                if (v) entry.startAt = withTime(entry.startAt, v);
              },
            }),
            h("span", { class: "dash" }, "–"),
            h("input", {
              type: "time",
              class: "t",
              value: hhmm(entry.endAt),
              onchange: (e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                if (v) entry.endAt = withTime(entry.endAt, v);
              },
            }),
          ),
          h("textarea", {
            class: "entry-note",
            rows: "2",
            placeholder: "Note",
            value: entry.description ?? "",
            oninput: (e: Event) => {
              entry.description = (e.target as HTMLTextAreaElement).value;
            },
          }),
        );
      }),
    );
    frag.append(list);

    const fillable = newCount + overrideCount;
    frag.append(
      h(
        "button",
        { class: "btn block", onclick: () => void this.startFill(), ...(fillable === 0 ? { disabled: "true" } : {}) },
        fillable === 0
          ? addedCount
            ? "All already in JobX"
            : "Nothing to fill"
          : `Fill ${fillable} into JobX`,
      ),
    );
    return frag;
  }

  private doneView(results: FillOutcome[], hireLabel: string): DocumentFragment {
    const frag = document.createDocumentFragment();
    const filled = results.filter((r) => r.status === "filled").length;
    frag.append(
      h("h2", { class: "sec" }, "Done"),
      h("p", { class: "muted" }, `Filled ${filled} of ${results.length} into ${hireLabel}. Review the JobX rows, then submit them there.`),
    );
    const list = h(
      "div",
      { class: "list" },
      ...results.map((r) =>
        h(
          "div",
          { class: "result" },
          h("span", {}, r.date),
          r.status === "filled"
            ? h("span", { class: "ok" }, "Filled")
            : h("span", { class: "bad" }, r.detail ?? r.status),
        ),
      ),
    );
    frag.append(
      list,
      h("button", { class: "btn ghost block", onclick: () => this.set({ screen: "ready" }) }, "Pull again"),
    );
    return frag;
  }
}
