import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node } from "prosemirror-model";
import {
  AgentTouchTracker,
  AGENT_TOUCH_EXPIRE_MS,
  AGENT_TOUCH_FADE_MS,
  type AgentTouch,
} from "~/components/collab/agent";

export interface AwarenessLike {
  clientID: number;
  getStates(): Map<number, unknown>;
  on(event: "change", fn: () => void): void;
  off(event: "change", fn: () => void): void;
}

export const agentTouchPluginKey = new PluginKey<DecorationSet>("daliAgentTouch");

function decorate(doc: Node, touches: AgentTouch[]): DecorationSet {
  if (touches.length === 0) return DecorationSet.empty;
  const byId = new Map(touches.map((t) => [t.id, t]));
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "blockContainer") return true;
    const touch = byId.get(node.attrs.id as string);
    if (touch) {
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: `dali-agent-touched dali-agent-touched-${touch.batch % 2 ? "a" : "b"}`,
          style: `--dali-agent: ${touch.color}; --dali-agent-fade: ${AGENT_TOUCH_FADE_MS}ms`,
        }),
      );
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

/** Tints the blocks an agent just changed, read from the collab awareness. */
export function createAgentTouchPlugin(
  awareness: AwarenessLike,
  options: { now?: () => number; expireMs?: number } = {},
) {
  const tracker = new AgentTouchTracker(options.now, options.expireMs ?? AGENT_TOUCH_EXPIRE_MS);
  const build = (state: EditorState) => decorate(state.doc, tracker.touches());

  return new Plugin<DecorationSet>({
    key: agentTouchPluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set, _old, state) {
        if (tr.getMeta(agentTouchPluginKey)) return build(state);
        if (!tr.docChanged) return set;
        // A touched block's content can arrive after the awareness naming it.
        return tracker.nextExpiryIn() === null ? set.map(tr.mapping, tr.doc) : build(state);
      },
    },
    props: {
      decorations: (state) => agentTouchPluginKey.getState(state),
    },
    view(view) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let destroyed = false;
      const refresh = () => {
        if (destroyed) return;
        view.dispatch(view.state.tr.setMeta(agentTouchPluginKey, true).setMeta("addToHistory", false));
        schedule();
      };
      const schedule = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        const next = tracker.nextExpiryIn();
        if (next === null) return;
        timer = setTimeout(() => {
          timer = null;
          if (tracker.sweep()) refresh();
          else schedule();
        }, next);
      };
      const onChange = () => {
        if (tracker.update(awareness.getStates(), awareness.clientID)) refresh();
      };
      awareness.on("change", onChange);
      queueMicrotask(onChange);
      return {
        destroy() {
          destroyed = true;
          awareness.off("change", onChange);
          if (timer) clearTimeout(timer);
        },
      };
    },
  });
}
