import { AsyncLocalStorage } from "node:async_hooks";
import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import type { Hocuspocus } from "@hocuspocus/server";
import { publish, subscribe } from "~/lib/realtime-bus.server";
import { BLOCKNOTE_FRAGMENT } from "~/components/doc/schema/configs";
import { presenceRoomName } from "./roomName";
import {
  agentClientId,
  agentKindFromClientName,
  agentDisplayName,
  agentSessionColor,
  agentSessionLabel,
  isAgentState,
  AGENT_TOUCHED_MAX,
  AGENT_TOUCH_EXPIRE_MS,
  type AgentAction,
  type AgentKind,
  type AgentTouched,
} from "~/components/collab/agent";

export const AGENT_LINGER_MS = 60_000;
export const AGENT_RENEW_MS = 10_000;
export const AGENT_HIGHLIGHT_MS = 2_500;
export const AGENT_TOUCH_MS = AGENT_TOUCH_EXPIRE_MS;
const BUS_TOPIC = "collab:agent-presence";

export type AgentIdentity = {
  clientName: string;
  userId: string;
  ownerName: string;
  /** Separates one person's concurrent agent connections; a key only, never shown. */
  session?: string;
};

export type AgentPoint = { blockId: string; offset?: number; at?: "start" | "end" };
export type AgentPointing = AgentPoint & { selectTo?: Partial<AgentPoint> };

export type AgentAnnouncement = {
  kind: AgentKind;
  name: string;
  userId: string;
  ownerName: string;
  action: AgentAction;
  session?: string;
  /** Publisher clock: orders a person's sessions the same way on every machine. */
  at?: number;
  presenceRoom?: string;
  docRoom?: string;
  /** Relative-position JSON of what the write added; null when it added no text. */
  range?: { start: unknown; end: unknown } | null;
  /** Block ids the edit inserted or changed. */
  touched?: string[];
  point?: AgentPointing;
};

const agentContext = new AsyncLocalStorage<AgentIdentity>();

/** Marks the rest of this MCP request as performed by an agent. */
export function enterAgentContext(identity: AgentIdentity): void {
  agentContext.enterWith(identity);
}

export function currentAgent(): AgentIdentity | undefined {
  return agentContext.getStore();
}

export function pagePresenceRoom(pageId: string): string {
  return presenceRoomName(`doc:${pageId}`);
}

type AnnounceTarget = Pick<
  AgentAnnouncement,
  "action" | "presenceRoom" | "docRoom" | "range" | "touched" | "point"
>;

function announceAs(agent: AgentIdentity, target: AnnounceTarget): void {
  const kind = agentKindFromClientName(agent.clientName);
  const touched = target.touched
    ?.filter((id) => typeof id === "string" && id.length > 0)
    .slice(-AGENT_TOUCHED_MAX);
  const msg: AgentAnnouncement = {
    kind,
    name: agentDisplayName(kind, agent.clientName),
    userId: agent.userId,
    ownerName: agent.ownerName,
    ...(agent.session ? { session: agent.session } : {}),
    at: Date.now(),
    ...target,
    ...(touched ? { touched } : {}),
  };
  try {
    publish(BUS_TOPIC, JSON.stringify(msg));
  } catch (err) {
    console.error("[agent-presence] announce failed", err);
  }
}

/**
 * Show the calling agent on a doc (cursor) and/or a page's presence bar.
 * No-op outside an MCP request. Never throws: presence is decoration on top of the real operation.
 */
export async function announceAgent(target: AnnounceTarget): Promise<void> {
  (await agentAnnouncer())(target);
}

/**
 * Returns a synchronous announcer: a writer starts this before its write and
 * announces the moment the body changes, not after the document finishes
 * saving.
 */
export async function agentAnnouncer(): Promise<(target: AnnounceTarget) => void> {
  const agent = currentAgent();
  if (!agent) return () => {};
  return (target) => announceAs(agent, target);
}

export class AgentBlockNotFoundError extends Error {
  readonly code = "BLOCK_NOT_FOUND" as const;
  constructor(readonly blockId: string) {
    super(`Block '${blockId}' is not in the document`);
    this.name = "AgentBlockNotFoundError";
  }
}

let attached: Hocuspocus | null = null;

/**
 * Non-agent awareness clients in a doc room on this machine. Null when this
 * machine doesn't have the doc loaded but another one might (Redis set).
 */
export function docViewerCount(docRoom: string): number | null {
  const doc = attached?.documents.get(docRoom);
  if (!doc) return process.env.REDIS_URL ? null : 0;
  let count = 0;
  for (const [id, state] of doc.awareness.getStates()) {
    if (id !== doc.awareness.clientID && !isAgentState(state)) count++;
  }
  return count;
}

/**
 * Put the calling agent's caret (or a selection) on a block without editing.
 * Each machine resolves the point against its own copy of the doc.
 */
export function pointAgent(
  params: { docRoom: string; presenceRoom?: string } & AgentPointing,
): { seen: number | null } {
  const { docRoom, presenceRoom, ...point } = params;
  const doc = attached?.documents.get(docRoom);
  if (doc) {
    for (const id of [point.blockId, point.selectTo?.blockId]) {
      if (id !== undefined && !findBlockElement(doc, id)) throw new AgentBlockNotFoundError(id);
    }
  }
  const agent = currentAgent();
  if (agent) {
    announceAs(agent, {
      action: "pointing",
      docRoom,
      ...(presenceRoom ? { presenceRoom } : {}),
      point,
    });
  }
  return { seen: docViewerCount(docRoom) };
}

/** First and last text positions of the BlockNote body, or null when empty. */
export function bodyTexts(doc: Y.Doc): Y.XmlText[] {
  const texts: Y.XmlText[] = [];
  const walk = (node: Y.XmlFragment | Y.XmlElement) => {
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText) texts.push(child);
      else if (child instanceof Y.XmlElement) walk(child);
    }
  };
  walk(doc.getXmlFragment(BLOCKNOTE_FRAGMENT));
  return texts;
}

/**
 * Span of the texts a write added or changed, found by trimming the texts it
 * left alone from both ends. A full-body replace rebuilds every node, so Yjs
 * item identity can't tell an unchanged line from a new one; the strings can.
 */
export function changedTextRange(
  before: string[],
  doc: Y.Doc,
): { start: unknown; end: unknown } | null {
  const after = bodyTexts(doc);
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]!.toString()) {
    head++;
  }
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]!.toString()
  ) {
    tail++;
  }
  const changed = after.slice(head, after.length - tail);
  const first = changed.find((t) => t.length > 0);
  const last = [...changed].reverse().find((t) => t.length > 0);
  if (!first || !last) return null;
  return {
    start: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(first, 0)),
    end: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(last, last.length)),
  };
}

function findBlockElement(doc: Y.Doc, id: string): Y.XmlElement | null {
  const walk = (node: Y.XmlFragment | Y.XmlElement): Y.XmlElement | null => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (child.nodeName === "blockContainer" && child.getAttribute("id") === id) return child;
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(doc.getXmlFragment(BLOCKNOTE_FRAGMENT));
}

function textsIn(root: Y.XmlElement): Y.XmlText[] {
  const out: Y.XmlText[] = [];
  const walk = (node: Y.XmlElement) => {
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText) out.push(child);
      else if (child instanceof Y.XmlElement) walk(child);
    }
  };
  walk(root);
  return out;
}

/** A relative position in a block's own text; inline elements count as zero characters. */
export function blockPosition(doc: Y.Doc, point: AgentPoint): Y.RelativePosition | null {
  const container = findBlockElement(doc, point.blockId);
  if (!container) return null;
  const first = container.length > 0 ? container.get(0) : null;
  const own = first instanceof Y.XmlElement && first.nodeName !== "blockGroup" ? first : container;
  const texts = textsIn(own);
  const last = texts.at(-1);

  if (typeof point.offset === "number" && Number.isFinite(point.offset) && last) {
    let left = Math.max(0, Math.floor(point.offset));
    for (const text of texts) {
      if (left < text.length || text === last) {
        const index = Math.min(left, text.length);
        // At a run's end, stick to the character before so typing after it doesn't drag the caret.
        return Y.createRelativePositionFromTypeIndex(text, index, index === text.length ? -1 : 0);
      }
      left -= text.length;
    }
  }
  if (point.at === "start") {
    return Y.createRelativePositionFromTypeIndex(texts[0] ?? own, 0, 0);
  }
  return last
    ? Y.createRelativePositionFromTypeIndex(last, last.length, -1)
    : Y.createRelativePositionFromTypeIndex(own, own.length, -1);
}

/** `{ anchor, head }` for a point, or a selection to `selectTo`; null when a block is missing. */
export function pointCursor(doc: Y.Doc, point: AgentPointing): { anchor: unknown; head: unknown } | null {
  const anchor = blockPosition(doc, point);
  if (!anchor) return null;
  let head = anchor;
  if (point.selectTo) {
    const to = blockPosition(doc, {
      blockId: point.selectTo.blockId ?? point.blockId,
      ...(point.selectTo.offset !== undefined ? { offset: point.selectTo.offset } : {}),
      ...(point.selectTo.at ? { at: point.selectTo.at } : {}),
    });
    if (!to) return null;
    head = to;
  }
  return { anchor: Y.relativePositionToJSON(anchor), head: Y.relativePositionToJSON(head) };
}

type Cursor = { anchor: unknown; head: unknown };
type Look = { label: string; color: string };

export function presenceRoomState(msg: AgentAnnouncement, look: Look) {
  return {
    user: {
      name: look.label,
      color: look.color,
      lastActive: Date.now(),
      idle: false,
      userId: msg.userId,
      photoUrl: null,
      subtitle: `${msg.ownerName}'s agent`,
      agent: { kind: msg.kind, action: msg.action },
    },
  };
}

export function docRoomState(
  msg: AgentAnnouncement,
  look: Look,
  cursor: Cursor | null,
  touched: AgentTouched | null,
) {
  return {
    user: { name: look.label, color: look.color, agent: { kind: msg.kind, action: msg.action } },
    cursor,
    ...(touched ? { touched } : {}),
  };
}

type Timer = ReturnType<typeof setTimeout>;

type Live = {
  key: string;
  group: string;
  room: string;
  role: "presence" | "doc";
  session: string | undefined;
  firstAt: number;
  hocuspocus: Hocuspocus;
  msg: AgentAnnouncement;
  look: Look;
  clientId: number;
  awareness: Awareness | null;
  /** Resolved against this machine's doc; undefined until the doc is here. */
  range: { start: unknown; end: unknown } | null | undefined;
  highlight: boolean;
  touched: AgentTouched | null;
  seq: number;
  linger: Timer | null;
  collapse: Timer | null;
  touch: Timer | null;
  renew: ReturnType<typeof setInterval> | null;
};

// One synthetic awareness client per (room, person, agent kind, session) on
// every machine, tracked even where the room isn't loaded so each machine
// numbers sessions alike. The clientId is derived, not random, so every
// machine injects the SAME entry and the Redis-forwarded copy collapses into it.
const live = new Map<string, Live>();

function push(target: Awareness, source: Awareness) {
  applyAwarenessUpdate(target, encodeAwarenessUpdate(source, [source.clientID]), null);
}

function resolveRange(entry: Live, doc: Y.Doc) {
  if (entry.range !== undefined) return entry.range;
  const { msg } = entry;
  if (msg.action === "editing") {
    entry.range = msg.range !== undefined ? msg.range : changedTextRange([], doc);
  } else if (msg.action === "pointing" && msg.point) {
    const cursor = pointCursor(doc, msg.point);
    entry.range = cursor && { start: cursor.anchor, end: cursor.head };
  } else {
    entry.range = null;
  }
  return entry.range;
}

function stateFor(entry: Live, doc: Y.Doc): Record<string, unknown> {
  if (entry.role === "presence") return presenceRoomState(entry.msg, entry.look);
  const range = resolveRange(entry, doc);
  const cursor = range
    ? { anchor: entry.highlight || entry.msg.action === "pointing" ? range.start : range.end, head: range.end }
    : null;
  return docRoomState(entry.msg, entry.look, cursor, entry.touched);
}

function publishEntry(entry: Live) {
  if (live.get(entry.key) !== entry) return;
  const doc = entry.hocuspocus.documents.get(entry.room);
  if (!doc) return;
  if (!entry.awareness) {
    const ydoc = new Y.Doc();
    ydoc.clientID = entry.clientId;
    entry.awareness = new Awareness(ydoc);
    // Peers drop awareness updates whose clock isn't above the last one they
    // saw for this id, and they remember it after the agent leaves.
    const prior = doc.awareness.meta.get(entry.clientId);
    if (prior) entry.awareness.meta.set(entry.clientId, { clock: prior.clock, lastUpdated: Date.now() });
  }
  entry.awareness.setLocalState(stateFor(entry, doc));
  push(doc.awareness, entry.awareness);
}

function retire(entry: Live) {
  const awareness = entry.awareness;
  if (!awareness) return;
  entry.awareness = null;
  awareness.setLocalState(null);
  const doc = entry.hocuspocus.documents.get(entry.room);
  if (doc) push(doc.awareness, awareness);
  awareness.destroy();
  awareness.doc.destroy();
}

function siblings(group: string): Live[] {
  return [...live.values()]
    .filter((e) => e.group === group)
    .sort((a, b) => a.firstAt - b.firstAt || (a.session ?? "").localeCompare(b.session ?? ""));
}

/**
 * Re-number one person's sessions of one agent kind in a room. A session whose
 * name or colour changes comes back under a new clientId: editors build a
 * caret's label once per client and never update it.
 */
function renumber(group: string, quiet?: Live) {
  const taken: string[] = [];
  siblings(group).forEach((entry, index) => {
    const color = agentSessionColor(entry.msg.kind, index, `${entry.msg.userId}|${entry.session ?? "-"}`, taken);
    taken.push(color);
    const look = { label: agentSessionLabel(entry.msg.name, index), color };
    const clientId =
      index === 0
        ? agentClientId(entry.msg.userId, entry.msg.kind, entry.session)
        : agentClientId(entry.msg.userId, entry.msg.kind, entry.session, `${index}|${color}`);
    const changed = look.label !== entry.look.label || look.color !== entry.look.color;
    entry.look = look;
    if (entry.clientId !== 0 && clientId !== entry.clientId) {
      retire(entry);
      clearTimer(entry, "touch");
      entry.touched = null;
    }
    entry.clientId = clientId;
    if (entry !== quiet && (changed || !entry.awareness)) publishEntry(entry);
  });
}

function clearTimer(entry: Live, name: "linger" | "collapse" | "touch") {
  const t = entry[name];
  if (t) clearTimeout(t);
  entry[name] = null;
}

function drop(entry: Live) {
  if (live.get(entry.key) !== entry) return;
  clearTimer(entry, "linger");
  clearTimer(entry, "collapse");
  clearTimer(entry, "touch");
  if (entry.renew) clearInterval(entry.renew);
  entry.renew = null;
  retire(entry);
  live.delete(entry.key);
  renumber(entry.group);
}

function track(hocuspocus: Hocuspocus, room: string, role: Live["role"], msg: AgentAnnouncement) {
  const group = [room, msg.userId, msg.kind].join("\0");
  const key = `${group}\0${msg.session ?? "-"}`;
  let entry = live.get(key);
  if (!entry) {
    entry = {
      key,
      group,
      room,
      role,
      session: msg.session,
      firstAt: msg.at ?? Date.now(),
      hocuspocus,
      msg,
      look: { label: "", color: "" },
      clientId: 0,
      awareness: null,
      range: undefined,
      highlight: false,
      touched: null,
      seq: 0,
      linger: null,
      collapse: null,
      touch: null,
      renew: null,
    };
    live.set(key, entry);
    renumber(group, entry);
  }
  const current = entry;
  current.hocuspocus = hocuspocus;
  current.msg = msg;
  current.range = undefined;

  clearTimer(current, "collapse");
  if (role === "doc") {
    const touched = msg.touched?.slice(-AGENT_TOUCHED_MAX) ?? [];
    current.highlight = msg.action === "editing" && touched.length === 0;
    if (touched.length > 0) {
      current.seq = Math.max(current.seq + 1, msg.at ?? 0);
      current.touched = { ids: touched, seq: current.seq };
      clearTimer(current, "touch");
      current.touch = setTimeout(() => {
        current.touch = null;
        current.touched = null;
        publishEntry(current);
      }, AGENT_TOUCH_MS);
    }
    if (current.highlight) {
      current.collapse = setTimeout(() => {
        current.collapse = null;
        current.highlight = false;
        publishEntry(current);
      }, AGENT_HIGHLIGHT_MS);
    }
  }

  clearTimer(current, "linger");
  current.linger = setTimeout(() => drop(current), AGENT_LINGER_MS);
  current.renew ??= setInterval(() => publishEntry(current), AGENT_RENEW_MS);

  publishEntry(current);
}

export function applyAgentAnnouncement(hocuspocus: Hocuspocus, msg: AgentAnnouncement) {
  if (msg.presenceRoom) track(hocuspocus, msg.presenceRoom, "presence", msg);
  if (msg.docRoom) track(hocuspocus, msg.docRoom, "doc", msg);
}

/** Every machine applies announcements to the rooms it has open. */
export function attachAgentPresence(hocuspocus: Hocuspocus): () => void {
  attached = hocuspocus;
  const unsubscribe = subscribe(BUS_TOPIC, (_event, data) => {
    if (!data) return;
    try {
      applyAgentAnnouncement(hocuspocus, JSON.parse(data) as AgentAnnouncement);
    } catch (err) {
      console.error("[agent-presence] apply failed", err);
    }
  });
  return () => {
    unsubscribe();
    if (attached === hocuspocus) attached = null;
    for (const entry of [...live.values()]) if (entry.hocuspocus === hocuspocus) drop(entry);
  };
}
