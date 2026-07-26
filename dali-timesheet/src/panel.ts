import { PANEL_CSS } from "./panel-styles";
import { sendToWorker } from "./messages";
import type {
  StatusReply,
  PairStartReply,
  PairPollReply,
  PullReply,
  SignOutReply,
} from "./messages";
import type { TimesheetExport, FillOutcome } from "./types";
import { fillEntries } from "./jobx";
import { DEFAULT_LOOKBACK_DAYS } from "./config";

type State =
  | { screen: "loading" }
  | { screen: "disconnected"; error?: string }
  | { screen: "pairing"; code: string; message?: string }
  | { screen: "ready"; busy?: boolean; error?: string }
  | { screen: "pulled"; data: TimesheetExport; switching?: boolean; error?: string }
  | { screen: "filling" }
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
    else if (key === "onclick") node.addEventListener("click", value as EventListener);
    else if (key === "onchange") node.addEventListener("change", value as EventListener);
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
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export class Panel {
  private host: HTMLElement;
  private mount: HTMLElement;
  private state: State = { screen: "loading" };
  private pollTimer: ReturnType<typeof setInterval> | null = null;

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

  private async init(): Promise<void> {
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
      this.set({ screen: "pulled", data: reply.data });
    } else if (reply.code === "auth") {
      this.set({ screen: "disconnected", error: reply.message });
    } else {
      this.set({ screen: "ready", error: reply.message });
    }
  }

  private fill(): void {
    if (this.state.screen !== "pulled") return;
    const { data } = this.state;
    this.set({ screen: "filling" });
    // Fields already reflect only this hire's entries, so the fill is
    // role-scoped by construction — nothing else lands on the wrong timesheet.
    const results = fillEntries(data.entries);
    this.set({ screen: "done", results, hireLabel: data.hireLabel });
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
      { class: "head" },
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
        body.append(this.pulledView(s.data, s.switching, s.error));
        break;

      case "filling":
        body.append(h("div", { class: "center" }, h("span", { class: "spin" }), h("p", { class: "muted" }, "Filling your JobX timesheet…")));
        break;

      case "done":
        body.append(this.doneView(s.results, s.hireLabel));
        break;
    }
    return body;
  }

  private pulledView(data: TimesheetExport, switching?: boolean, error?: string): DocumentFragment {
    const frag = document.createDocumentFragment();

    // Role picker — the fill only ever touches the selected role's timesheet.
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

    frag.append(
      h(
        "div",
        { class: "row" },
        h("span", { class: "pill" }, `${data.entries.length} ${data.entries.length === 1 ? "entry" : "entries"}`),
        switching ? h("span", { class: "spin" }) : h("span", { class: "muted" }, `→ ${data.hireLabel}`),
      ),
    );

    const list = h(
      "div",
      { class: "list" },
      ...data.entries.map((entry) =>
        h(
          "div",
          { class: "entry" },
          h(
            "div",
            { class: "top" },
            h("span", { class: "date" }, fmtDate(entry.startAt)),
            h("span", { class: "time" }, `${fmtTime(entry.startAt)} – ${fmtTime(entry.endAt)}`),
          ),
          (entry.description ?? "").trim()
            ? h("span", { class: "note" }, entry.description)
            : h("span", { class: "note empty" }, "No note"),
        ),
      ),
    );
    frag.append(list);

    frag.append(
      h(
        "button",
        { class: "btn block", onclick: () => this.fill(), ...(data.entries.length === 0 ? { disabled: "true" } : {}) },
        `Fill ${data.entries.length} into JobX`,
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
