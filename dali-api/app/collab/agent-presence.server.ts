import { AsyncLocalStorage } from "node:async_hooks";
import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import type { Hocuspocus } from "@hocuspocus/server";
import { publish, subscribe } from "~/lib/realtime-bus.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getUserRoles } from "~/lib/roles";
import { BLOCKNOTE_FRAGMENT } from "~/components/doc/schema/configs";
import { presenceRoomName } from "./roomName";
import {
  agentClientId,
  agentKindFromClientName,
  agentDisplayName,
  AGENT_COLORS,
  type AgentAction,
  type AgentKind,
} from "~/components/collab/agent";

export const AGENT_LINGER_MS = 20_000;
export const AGENT_HIGHLIGHT_MS = 2_500;
const BUS_TOPIC = "collab:agent-presence";

export type AgentIdentity = {
  clientName: string;
  userId: string;
  ownerName: string;
};

export type AgentAnnouncement = {
  kind: AgentKind;
  name: string;
  userId: string;
  ownerName: string;
  action: AgentAction;
  presenceRoom?: string;
  docRoom?: string;
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

/**
 * Show the calling agent on a doc (cursor) and/or a page's presence bar.
 * No-op outside an MCP request or when the caller's agent-presence flag is
 * off. Never throws: presence is decoration on top of the real operation.
 */
export async function announceAgent(target: AnnounceTarget): Promise<void> {
  (await agentAnnouncer())(target);
}

type AnnounceTarget = {
  action: AgentAction;
  presenceRoom?: string;
  docRoom?: string;
};

/**
 * Resolves the caller's flag up front so the announcement itself is
 * synchronous: a writer starts this before its write and announces the moment
 * the body changes, not after the document finishes saving.
 */
export async function agentAnnouncer(): Promise<(target: AnnounceTarget) => void> {
  const noop = () => {};
  const agent = currentAgent();
  if (!agent) return noop;
  try {
    const roles = await getUserRoles(agent.userId);
    if (!(await isFeatureEnabled("agent-presence", agent.userId, roles))) return noop;
  } catch (err) {
    console.error("[agent-presence] announce failed", err);
    return noop;
  }
  const kind = agentKindFromClientName(agent.clientName);
  return (target) => {
    const msg: AgentAnnouncement = {
      kind,
      name: agentDisplayName(kind, agent.clientName),
      userId: agent.userId,
      ownerName: agent.ownerName,
      ...target,
    };
    try {
      publish(BUS_TOPIC, JSON.stringify(msg));
    } catch (err) {
      console.error("[agent-presence] announce failed", err);
    }
  };
}

type Live = {
  awareness: Awareness;
  linger: ReturnType<typeof setTimeout> | null;
  collapse: ReturnType<typeof setTimeout> | null;
};

// One synthetic awareness client per (room, agent) on this machine. The
// clientId is derived from (owner, kind) rather than random so every machine
// injects the SAME entry: the Hocuspocus Redis extension also forwards it,
// and a shared id lets the forwarded copy collapse into the local one.
const live = new Map<string, Live>();

export function presenceRoomState(msg: AgentAnnouncement) {
  return {
    user: {
      name: msg.name,
      color: AGENT_COLORS[msg.kind],
      lastActive: Date.now(),
      idle: false,
      userId: msg.userId,
      photoUrl: null,
      subtitle: `${msg.ownerName}'s agent`,
      agent: { kind: msg.kind, action: msg.action },
    },
  };
}

/** First and last text positions of the BlockNote body, or null when empty. */
export function bodyTextRange(
  doc: Y.Doc,
): { start: Y.RelativePosition; end: Y.RelativePosition } | null {
  const texts: Y.XmlText[] = [];
  const walk = (node: Y.XmlFragment | Y.XmlElement) => {
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText) texts.push(child);
      else if (child instanceof Y.XmlElement) walk(child);
    }
  };
  walk(doc.getXmlFragment(BLOCKNOTE_FRAGMENT));
  const first = texts.find((t) => t.length > 0);
  const last = [...texts].reverse().find((t) => t.length > 0);
  if (!first || !last) return null;
  return {
    start: Y.createRelativePositionFromTypeIndex(first, 0),
    end: Y.createRelativePositionFromTypeIndex(last, last.length),
  };
}

export function docRoomState(msg: AgentAnnouncement, doc: Y.Doc, highlight: boolean) {
  const range = msg.action === "editing" ? bodyTextRange(doc) : null;
  return {
    user: {
      name: msg.name,
      color: AGENT_COLORS[msg.kind],
      agent: { kind: msg.kind, action: msg.action },
    },
    cursor: range
      ? {
          anchor: Y.relativePositionToJSON(highlight ? range.start : range.end),
          head: Y.relativePositionToJSON(range.end),
        }
      : null,
  };
}

function push(target: Awareness, source: Awareness) {
  applyAwarenessUpdate(target, encodeAwarenessUpdate(source, [source.clientID]), null);
}

function inject(
  hocuspocus: Hocuspocus,
  room: string,
  msg: AgentAnnouncement,
  stateFor: (doc: Y.Doc, highlight: boolean) => Record<string, unknown>,
) {
  const document = hocuspocus.documents.get(room);
  if (!document) return;
  const id = agentClientId(msg.userId, msg.kind);
  const key = `${room}|${id}`;
  let entry = live.get(key);
  if (!entry) {
    const ydoc = new Y.Doc();
    ydoc.clientID = id;
    entry = { awareness: new Awareness(ydoc), linger: null, collapse: null };
    // Peers drop awareness updates whose clock isn't above the last one they
    // saw for this id, and they remember it after the agent lingers out.
    const prior = document.awareness.meta.get(id);
    if (prior) entry.awareness.meta.set(id, { clock: prior.clock, lastUpdated: Date.now() });
    live.set(key, entry);
  }
  const current = entry;
  const set = (highlight: boolean) => {
    const doc = hocuspocus.documents.get(room);
    if (!doc) return;
    current.awareness.setLocalState(stateFor(doc, highlight));
    push(doc.awareness, current.awareness);
  };

  set(true);
  if (current.collapse) clearTimeout(current.collapse);
  current.collapse = setTimeout(() => set(false), AGENT_HIGHLIGHT_MS);
  if (current.linger) clearTimeout(current.linger);
  current.linger = setTimeout(() => {
    if (current.collapse) clearTimeout(current.collapse);
    current.awareness.setLocalState(null);
    const doc = hocuspocus.documents.get(room);
    if (doc) push(doc.awareness, current.awareness);
    current.awareness.destroy();
    current.awareness.doc.destroy();
    live.delete(key);
  }, AGENT_LINGER_MS);
}

export function applyAgentAnnouncement(hocuspocus: Hocuspocus, msg: AgentAnnouncement) {
  if (msg.presenceRoom) inject(hocuspocus, msg.presenceRoom, msg, () => presenceRoomState(msg));
  if (msg.docRoom) {
    inject(hocuspocus, msg.docRoom, msg, (doc, highlight) => docRoomState(msg, doc, highlight));
  }
}

/** Every machine applies announcements to the rooms it has open. */
export function attachAgentPresence(hocuspocus: Hocuspocus): () => void {
  return subscribe(BUS_TOPIC, (_event, data) => {
    if (!data) return;
    try {
      applyAgentAnnouncement(hocuspocus, JSON.parse(data) as AgentAnnouncement);
    } catch (err) {
      console.error("[agent-presence] apply failed", err);
    }
  });
}
