// Shared Y.Doc / HocuspocusProvider / y-indexeddb lifecycle for collaborative
// DocEditors — the same module-level refcounted cache the pre-BlockNote
// CollaborativeEditor used, and for the same reason: React StrictMode double-mounts effects, and
// without the cache the editor binds to one Y.Doc while a duplicate provider
// leaks, silently breaking sync. Disposal is deferred 500ms so the simulated
// unmount+remount reuses the same instance.
//
// The IndexedDB database name is the room name — identical to the legacy
// editor's cache for the same room. That's correct, not a collision: it's the
// same logical Y.Doc (BlockNote just binds the "blocknote" fragment inside
// it), so offline updates from either editor era merge into one store.

import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import { getCollabUrl } from "~/components/collab/util";

export interface CollabDocEntry {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  persistence: IndexeddbPersistence;
  refCount: number;
  disposeTimer: ReturnType<typeof setTimeout> | null;
}

const docCache = new Map<string, CollabDocEntry>();

export function acquireCollabDoc(documentName: string, token: string): CollabDocEntry {
  let entry = docCache.get(documentName);
  if (entry) {
    if (entry.disposeTimer) {
      clearTimeout(entry.disposeTimer);
      entry.disposeTimer = null;
    }
    entry.refCount++;
    return entry;
  }

  const ydoc = new Y.Doc();
  console.log(`[doc:${documentName}] Y.Doc created, clientID=${ydoc.clientID}`);

  // Local cache: instant load on reload; offline edits queue and replay.
  const persistence = new IndexeddbPersistence(documentName, ydoc);

  const provider = new HocuspocusProvider({
    url: getCollabUrl(),
    name: documentName,
    document: ydoc,
    token,
  });

  entry = { ydoc, provider, persistence, refCount: 1, disposeTimer: null };
  docCache.set(documentName, entry);
  return entry;
}

export function releaseCollabDoc(documentName: string) {
  const entry = docCache.get(documentName);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount > 0) return;
  entry.disposeTimer = setTimeout(() => {
    const current = docCache.get(documentName);
    if (!current || current.refCount > 0) return;
    console.log(`[doc:${documentName}] disposing`);
    current.provider.destroy();
    current.persistence.destroy();
    current.ydoc.destroy();
    docCache.delete(documentName);
  }, 500);
}

// y-prosemirror's yCursorPlugin builds CSS colors as `${color}` + a hex alpha
// suffix and warn-spams on non-hex values — the awareness color MUST be a
// 6-digit hex. Same hash + hue as the legacy nameToColor (hsl(h, 70%, 50%)),
// converted to hex so peers keep their historical color.
export function nameToHexColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = 0.5 - 0.35 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
