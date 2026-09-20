// Binding between an Excalidraw scene and a Yjs document, driven through the
// existing Hocuspocus provider. The scene's elements live in a Y.Map keyed by
// element id (Excalidraw elements carry their own fractional `index` for
// z-order, so a keyed map — set-only, with soft-delete tombstones — is enough;
// no fractional-indexing dependency or Y.Array move machinery needed). Images
// live in a separate Y.Map keyed by fileId.
//
// Correctness rules (see specs/whiteboard.md):
//  - Every local write goes through ydoc.transact(fn, LOCAL_ORIGIN); the remote
//    observer early-returns when transaction.origin === LOCAL_ORIGIN. That one
//    check breaks the echo loop.
//  - Remote applies use reconcileElements + captureUpdate: NEVER so peers'
//    edits converge deterministically (version / versionNonce tiebreak) and
//    never pollute the local undo/redo stack.
//  - Objects put into / read from Yjs are treated as immutable — we store a
//    shallow clone ({ ...el }) and never mutate values we read back.

import * as Y from "yjs";
import { reconcileElements, CaptureUpdateAction } from "@excalidraw/excalidraw";
import type {
  ExcalidrawImperativeAPI,
  AppState,
  BinaryFiles,
  BinaryFileData,
  Collaborator,
} from "@excalidraw/excalidraw/types";
import type { HocuspocusProvider } from "@hocuspocus/provider";

type SceneElement = ReturnType<ExcalidrawImperativeAPI["getSceneElementsIncludingDeleted"]>[number];
type ProviderAwareness = NonNullable<HocuspocusProvider["awareness"]>;
// Excalidraw keys collaborators by a branded SocketId; we key by the awareness
// clientId string, so cast at the boundary.
type UpdateSceneCollaborators = NonNullable<
  Parameters<ExcalidrawImperativeAPI["updateScene"]>[0]["collaborators"]
>;

const ELEMENTS_KEY = "elements";
const FILES_KEY = "files";

export interface WhiteboardBinding {
  onChange: (elements: readonly SceneElement[], appState: AppState, files: BinaryFiles) => void;
  onPointerUpdate: (payload: {
    pointer: { x: number; y: number; tool: "pointer" | "laser" };
    button: "up" | "down";
    pointersMap: Map<number, unknown>;
  }) => void;
  destroy: () => void;
}

export interface WhiteboardBindingOptions {
  ydoc: Y.Doc;
  awareness: ProviderAwareness | null;
  api: ExcalidrawImperativeAPI;
  editable: boolean;
  user: { name: string; color: string; avatarUrl: string | null };
}

export function bindExcalidrawToYjs(opts: WhiteboardBindingOptions): WhiteboardBinding {
  const { ydoc, awareness, api, editable, user } = opts;
  const yElements = ydoc.getMap<unknown>(ELEMENTS_KEY);
  const yFiles = ydoc.getMap<BinaryFileData>(FILES_KEY);
  // Stable per-binding origin object; identity comparison is the echo guard.
  const LOCAL_ORIGIN = { whiteboard: ydoc.clientID };

  // id -> last-applied version. Shared by the local writer and the remote
  // applier: after a remote updateScene re-fires onChange, the versions already
  // match, so nothing is written back.
  let lastKnown = new Map<string, number>();

  function applyRemoteFiles() {
    const files: BinaryFileData[] = [];
    yFiles.forEach((f) => files.push(f));
    // addFiles is idempotent (keyed by id), so re-adding is safe.
    if (files.length > 0) api.addFiles(files);
  }

  function applyRemote() {
    const remote = Array.from(yElements.values()) as SceneElement[];
    if (remote.length === 0) return;
    const local = api.getSceneElementsIncludingDeleted();
    const reconciled = reconcileElements(
      local as unknown as Parameters<typeof reconcileElements>[0],
      remote as unknown as Parameters<typeof reconcileElements>[1],
      api.getAppState(),
    );
    api.updateScene({ elements: reconciled, captureUpdate: CaptureUpdateAction.NEVER });
    lastKnown = new Map(reconciled.map((el) => [el.id, el.version]));
    applyRemoteFiles();
  }

  const elementsObserver = (_events: unknown, txn: Y.Transaction) => {
    if (txn.origin === LOCAL_ORIGIN) return;
    applyRemote();
  };
  const filesObserver = (_events: unknown, txn: Y.Transaction) => {
    if (txn.origin === LOCAL_ORIGIN) return;
    applyRemoteFiles();
  };
  yElements.observe(elementsObserver);
  yFiles.observe(filesObserver);

  if (awareness) {
    awareness.setLocalStateField("user", {
      name: user.name,
      color: user.color,
      avatarUrl: user.avatarUrl,
    });
  }

  function pushCollaborators() {
    if (!awareness) return;
    const collaborators = new Map<string, Collaborator>();
    awareness.getStates().forEach((state, clientId) => {
      if (clientId === awareness.clientID) return; // never render our own cursor
      const u = (state.user ?? {}) as { name?: string; color?: string; avatarUrl?: string | null };
      collaborators.set(String(clientId), {
        pointer: state.pointer as Collaborator["pointer"],
        button: state.button as Collaborator["button"],
        selectedElementIds: state.selectedElementIds as Collaborator["selectedElementIds"],
        username: u.name ?? null,
        color: u.color ? { background: u.color, stroke: u.color } : undefined,
        avatarUrl: u.avatarUrl ?? undefined,
      });
    });
    api.updateScene({ collaborators: collaborators as unknown as UpdateSceneCollaborators });
  }
  const awarenessObserver = () => pushCollaborators();
  awareness?.on("change", awarenessObserver);

  // Pull whatever's already loaded (fast IndexedDB cache / already-synced room).
  applyRemote();
  pushCollaborators();

  function onChange(elements: readonly SceneElement[], appState: AppState, files: BinaryFiles) {
    if (editable) {
      const seen = new Set<string>();
      const changed: SceneElement[] = [];
      for (const el of elements) {
        seen.add(el.id);
        if (lastKnown.get(el.id) !== el.version) changed.push(el);
      }
      // Elements dropped from the scene entirely (Excalidraw usually soft-deletes,
      // keeping a tombstone in `elements`, but a hard removal drops them here).
      const removed: string[] = [];
      yElements.forEach((_v, id) => {
        if (!seen.has(id)) removed.push(id);
      });
      if (changed.length > 0 || removed.length > 0) {
        ydoc.transact(() => {
          for (const el of changed) yElements.set(el.id, { ...el });
          for (const id of removed) yElements.delete(id);
        }, LOCAL_ORIGIN);
      }
      lastKnown = new Map(elements.map((el) => [el.id, el.version]));

      // Images: add-only into the shared files map. NOTE (v1): base64 dataURLs
      // live in the CRDT — see specs/whiteboard.md; S3 offload is a follow-up to
      // keep the doc small.
      const toAddFiles: Array<[string, BinaryFileData]> = [];
      for (const id of Object.keys(files)) {
        if (!yFiles.has(id)) toAddFiles.push([id, files[id]]);
      }
      if (toAddFiles.length > 0) {
        ydoc.transact(() => {
          for (const [id, f] of toAddFiles) yFiles.set(id, f);
        }, LOCAL_ORIGIN);
      }
    }

    if (awareness) {
      awareness.setLocalStateField("selectedElementIds", appState.selectedElementIds);
    }
  }

  function onPointerUpdate(payload: {
    pointer: { x: number; y: number; tool: "pointer" | "laser" };
    button: "up" | "down";
    pointersMap: Map<number, unknown>;
  }) {
    if (!awareness) return;
    if (payload.pointersMap && payload.pointersMap.size >= 2) return; // ignore pinch/multi-touch
    awareness.setLocalStateField("pointer", payload.pointer);
    awareness.setLocalStateField("button", payload.button);
  }

  function destroy() {
    yElements.unobserve(elementsObserver);
    yFiles.unobserve(filesObserver);
    awareness?.off("change", awarenessObserver);
  }

  return { onChange, onPointerUpdate, destroy };
}
