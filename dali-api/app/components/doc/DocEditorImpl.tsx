// DocEditor implementation — CLIENT-ONLY (loaded via React.lazy behind the
// mounted gate in DocEditor.tsx; never import this module from a route).
//
// Two modes off one shared view:
//   local  — useCreateBlockNote with schema + normalized initialContent.
//   collab — refcounted Y.Doc cache + HocuspocusProvider + y-indexeddb, bound
//            to the "blocknote" fragment via withCollaboration (the 0.52 API;
//            the old `collaboration` editor option is gone), plus the yUndo
//            keep-alive fix below.

import "@blocknote/shadcn/style.css";
import "./blocknote.tailwind.css";
import "./theme.css";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import type { EditorState } from "prosemirror-state";
import type * as Y from "yjs";
import { withCollaboration } from "@blocknote/core/yjs";
import { en } from "@blocknote/core/locales";
import { SuggestionMenuController, useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";

import { countWords, extractHeadings, normalizeInitialContent } from "./blocks-util";
import { acquireCollabDoc, nameToHexColor, releaseCollabDoc, type CollabDocEntry } from "./collab-doc";
import { DocEditorFallback } from "./DocEditor";
import { resolveFeatures, type Features } from "./features";
import { buildSchema, type DocEditorInstance, type DocPartialBlock } from "./schema/build";
import { BLOCKNOTE_FRAGMENT } from "./schema/configs";
import { getMentionMenuItems } from "./schema/mention";
import { getFilteredDocSlashMenuItems } from "./schema/slash-menu";
import { DEFAULT_SIGNING_CTX, SigningContext } from "./signing-context";
import type { DocCollabConfig, DocEditorProps } from "./types";
import { uploadEditorImage } from "./upload";

export default function DocEditorImpl(props: DocEditorProps) {
  const features = resolveFeatures(props.features);
  if (props.collab) {
    return <CollabDoc {...props} features={features} collab={props.collab} />;
  }
  return <LocalDoc {...props} features={features} />;
}

// Resolved-features variants of the props (presets already applied).
type ResolvedProps = Omit<DocEditorProps, "features"> & { features: Features };

// ─── Local (non-collab) mode ────────────────────────────────────────────────

function LocalDoc(props: ResolvedProps) {
  const schema = useDocSchema(props.features);
  const dictionary = useDocDictionary(props.placeholder);
  // Normalized once per (schema, content) pair; the editor is recreated on
  // schema/dictionary change anyway, so this rides the same memo.
  const initialContent = useMemo(
    () => normalizeInitialContent<DocPartialBlock>(props.initialContent),
    [props.initialContent],
  );

  const editor = useCreateBlockNote(
    {
      schema,
      initialContent,
      dictionary,
      uploadFile: props.features.images ? uploadEditorImage : undefined,
    },
    [schema, dictionary],
  );

  return <DocView {...props} editor={editor} />;
}

// ─── Collaborative mode ─────────────────────────────────────────────────────

function CollabDoc(props: ResolvedProps & { collab: DocCollabConfig }) {
  const { documentName, token } = props.collab;
  const [entry, setEntry] = useState<CollabDocEntry | null>(null);

  useEffect(() => {
    const acquired = acquireCollabDoc(documentName, token);
    setEntry(acquired);
    return () => {
      releaseCollabDoc(documentName);
      setEntry(null);
    };
  }, [documentName, token]);

  // Gate the inner component (and key it per room) so useCreateBlockNote runs
  // once with the final fragment/provider.
  if (!entry) return <DocEditorFallback className={props.className} />;
  return <CollabDocInner key={documentName} {...props} entry={entry} />;
}

function CollabDocInner(
  props: ResolvedProps & { collab: DocCollabConfig; entry: CollabDocEntry },
) {
  const { entry } = props;
  const { userName, userId } = props.collab;
  const schema = useDocSchema(props.features);
  const dictionary = useDocDictionary(props.placeholder);

  const editor = useCreateBlockNote(
    // withCollaboration injects the CollaborationExtension (ySync + yCursor +
    // yUndo + schemaMigration), disables prosemirror-history (yUndo is
    // authoritative) and pins initialContent to a fixed block id so two fresh
    // clients don't seed conflicting random initial blocks.
    withCollaboration({
      schema,
      dictionary,
      uploadFile: props.features.images ? uploadEditorImage : undefined,
      collaboration: {
        fragment: entry.ydoc.getXmlFragment(BLOCKNOTE_FRAGMENT),
        // Awareness color must be 6-digit hex (y-prosemirror appends a hex
        // alpha suffix); extra keys like userId ride along for presence.
        user: {
          name: userName,
          color: nameToHexColor(userName),
          ...(userId ? { userId } : {}),
        },
        // HocuspocusProvider.awareness is `Awareness | null`; option wants
        // `Awareness | undefined`.
        provider: { awareness: entry.provider.awareness ?? undefined },
        // "always" is broken upstream (label CSS keys off a data-active
        // attribute that mode never sets); "activity" shows labels on cursor
        // movement/typing.
        showCursorLabels: "activity",
      },
    }),
    [schema, dictionary, entry],
  );

  // FIX (undo no-ops in collab): y-prosemirror's yUndoPlugin creates its
  // UndoManager in plugin-STATE init but destroys it from the plugin VIEW's
  // destroy(). BlockNote 0.52 / tiptap v3 keep the EditorState — plugin state
  // included — across editor.unmount()/mount() (StrictMode's simulated
  // remount, BlockNoteView's editable-change remount), so the first unmount
  // kills the manager and every later mount reuses the dead instance: undo
  // permanently no-ops. Neuter destroy() so the manager's lifetime matches the
  // EditorState that owns it; its real end of life is releaseCollabDoc's
  // ydoc.destroy(). Found by duck-typing over the live plugin list rather than
  // yUndoPluginKey.getState() — the prod bundle can inline y-prosemirror's key
  // module twice, making key-based lookup silently return null (the same trap
  // the legacy CollaborativeEditor documents).
  useEffect(() => {
    const um = findCollabUndoManager(editor.prosemirrorState);
    if (um) um.destroy = () => {};
  }, [editor]);

  return <DocView {...props} editor={editor} />;
}

function findCollabUndoManager(state: EditorState): Y.UndoManager | null {
  for (const plugin of state.plugins) {
    const pluginState = plugin.getState(state) as { undoManager?: Y.UndoManager } | undefined;
    if (pluginState && typeof pluginState.undoManager?.undo === "function") {
      return pluginState.undoManager;
    }
  }
  return null;
}

// ─── Shared view + chrome ───────────────────────────────────────────────────

function DocView(props: ResolvedProps & { editor: DocEditorInstance }) {
  const { editor, features } = props;
  useDocChrome(editor, props);
  const isDark = useIsDark();

  const menus: ReactNode = (
    <>
      {/* Custom "/" menu: defaults trimmed to the app command set + callout. */}
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={(query) => getFilteredDocSlashMenuItems(editor, features, query)}
      />
      {features.mentions && (
        <SuggestionMenuController
          triggerCharacter="@"
          getItems={(query) => getMentionMenuItems(editor, query)}
        />
      )}
    </>
  );

  return (
    <SigningContext.Provider value={props.signing ?? DEFAULT_SIGNING_CTX}>
      <div
        className={[
          "dali-doc",
          props.density === "compact" ? "dali-doc--compact" : "",
          props.className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <BlockNoteView
          editor={editor}
          // String theme only: BlockNote's default follows the SYSTEM color
          // scheme, but the app's dark mode is html.dark (user-overridable).
          theme={isDark ? "dark" : "light"}
          editable={props.editable ?? true}
          slashMenu={false}
          emojiPicker={false}
          // Compact fields don't need the drag-handle side menu (and its wide
          // gutter — see .dali-doc--compact in theme.css).
          sideMenu={props.density !== "compact"}
        >
          {menus}
        </BlockNoteView>
      </div>
    </SigningContext.Provider>
  );
}

/** onChange + throttled word count / H1–H3 outline (400ms, matching legacy).
 * editor.onChange also fires for remote collab transactions, so live peers'
 * edits keep the pages chrome fresh. */
function useDocChrome(
  editor: DocEditorInstance,
  props: Pick<DocEditorProps, "onChange" | "onWordCountChange" | "onHeadingsChange">,
) {
  const onChangeRef = useRef(props.onChange);
  const onWordCountRef = useRef(props.onWordCountChange);
  const onHeadingsRef = useRef(props.onHeadingsChange);
  onChangeRef.current = props.onChange;
  onWordCountRef.current = props.onWordCountChange;
  onHeadingsRef.current = props.onHeadingsChange;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const computeChrome = () => {
      const blocks = editor.document;
      onWordCountRef.current?.(countWords(blocks));
      onHeadingsRef.current?.(extractHeadings(blocks));
    };
    const wantChrome = () => onWordCountRef.current || onHeadingsRef.current;

    const unsubscribe = editor.onChange(() => {
      onChangeRef.current?.(editor.document);
      if (!wantChrome() || timer) return;
      timer = setTimeout(() => {
        timer = null;
        computeChrome();
      }, 400);
    });
    if (wantChrome()) computeChrome();

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe?.();
    };
  }, [editor]);
}

function useDocSchema(features: Features) {
  return useMemo(
    () => buildSchema(features),
    // Individual flags, not the object: hosts typically pass a fresh literal
    // every render and a schema rebuild recreates the whole editor.
    [features.mentions, features.images, features.richBlocks, Boolean(features.signing)],
  );
}

function useDocDictionary(placeholder: string | undefined) {
  return useMemo(() => {
    if (!placeholder) return en;
    // Only the empty-document placeholder is overridden; per-block "type /"
    // hints keep BlockNote's defaults.
    return { ...en, placeholders: { ...en.placeholders, emptyDocument: placeholder } };
  }, [placeholder]);
}

/** Tracks the app's html.dark class (set by ~/lib/theme applyTheme — covers
 * user preference, system changes, and cross-iframe sync). */
function useIsDark(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const observer = new MutationObserver(onChange);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
}
