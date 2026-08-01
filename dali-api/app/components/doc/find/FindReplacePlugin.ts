/**
 * ProseMirror plugin that manages find/replace decorations.
 *
 * Registered via BlockNote's `editor.registerExtension()` API (which accepts
 * `prosemirrorPlugins`). The plugin is a "state-only" plugin — it stores
 * match positions and the current-match index in plugin state and recomputes
 * decorations on every transaction that has `findReplaceMeta` set.
 *
 * External control flow:
 *   findReplaceKey.getState(view.state) → current FindPluginState
 *   dispatch(tr.setMeta(findReplaceKey, update)) → drives the plugin
 *
 * ProseMirror access path used:
 *   editor.prosemirrorView (public getter on BlockNoteEditor, documented in
 *   BlockNoteEditor.d.ts as `get prosemirrorView(): EditorView`) — the
 *   least-private path available (prosemirrorState is also public; _tiptapEditor
 *   is technically available but underscore-prefixed).
 */

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { findMatchRanges, type MatchRange } from "./findMatchRanges";

export interface FindPluginState {
  needle: string;
  matches: MatchRange[];
  /** 0-based index of the "current" (active/orange) match, or -1 when none. */
  current: number;
  decorations: DecorationSet;
}

export interface FindPluginUpdate {
  needle?: string;
  current?: number;
  /** When true, recompute matches even if the needle hasn't changed (doc edit). */
  recompute?: boolean;
}

export const findReplaceKey = new PluginKey<FindPluginState>("dali-find-replace");

/** CSS class names referenced in theme.css */
const CLS_MATCH = "dali-find-match";
const CLS_CURRENT = "dali-find-match--current";

function buildDecorations(
  doc: Parameters<typeof findMatchRanges>[0],
  matches: MatchRange[],
  current: number,
): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty;
  const decos = matches.map((m, i) =>
    Decoration.inline(m.from, m.to, {
      class: i === current ? `${CLS_MATCH} ${CLS_CURRENT}` : CLS_MATCH,
    }),
  );
  return DecorationSet.create(doc as import("prosemirror-model").Node, decos);
}

export function createFindReplacePlugin(): Plugin<FindPluginState> {
  return new Plugin<FindPluginState>({
    key: findReplaceKey,

    state: {
      init(_config, state) {
        return {
          needle: "",
          matches: [],
          current: -1,
          decorations: DecorationSet.empty,
        };
      },

      apply(tr, pluginState, _oldState, newState) {
        const meta = tr.getMeta(findReplaceKey) as FindPluginUpdate | undefined;

        if (!meta && !tr.docChanged) {
          // Map decorations through position changes (insertions/deletions).
          return {
            ...pluginState,
            decorations: pluginState.decorations.map(tr.mapping, newState.doc),
          };
        }

        // Merge update from external dispatch with existing state.
        const needle = meta?.needle !== undefined ? meta.needle : pluginState.needle;

        // Recompute matches when: needle changed, explicit recompute flag, or doc changed.
        const needsRecompute =
          needle !== pluginState.needle || meta?.recompute || tr.docChanged;

        let matches = pluginState.matches;
        if (needsRecompute) {
          matches = findMatchRanges(
            newState.doc as unknown as Parameters<typeof findMatchRanges>[0],
            needle,
          );
        }

        // Determine current index.
        let current: number;
        if (meta?.current !== undefined) {
          current = Math.max(-1, Math.min(meta.current, matches.length - 1));
        } else if (needsRecompute) {
          // After a recompute, clamp current to valid range.
          current = matches.length > 0 ? Math.min(pluginState.current, matches.length - 1) : -1;
          if (current < 0 && matches.length > 0) current = 0;
        } else {
          current = pluginState.current;
        }

        const decorations = buildDecorations(
          newState.doc as unknown as Parameters<typeof findMatchRanges>[0],
          matches,
          current,
        );

        return { needle, matches, current, decorations };
      },
    },

    props: {
      decorations(state) {
        return findReplaceKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}
