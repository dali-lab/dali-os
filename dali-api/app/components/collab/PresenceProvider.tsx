import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { presenceRoomName } from "~/collab/roomName";
import {
  ACTIVITY_THROTTLE_MS,
  IDLE_AFTER_MS,
  IDLE_CHECK_MS,
  type AwarenessUser,
  getCollabUrl,
  nameToColor,
} from "./util";

/**
 * Page-scoped collaborative presence. Opens a sidecar y-doc per pageId used
 * only for awareness — no document fragment, no persisted content. Decouples
 * "who's on the page" from any specific editor, so it works on pages with no
 * editors at all.
 *
 * Editors opt-in via `useRegisterCollabEditor` to (a) register a `followPeer`
 * callback the bar can invoke, and (b) mark themselves as the local user's
 * `currentEditor` on focus.
 */

export interface Peer {
  clientId: number;
  name: string;
  color: string;
  idle: boolean;
  isMe: boolean;
  currentEditor?: string;
  userId?: string;
  photoUrl?: string | null;
  subtitle?: string | null;
}

interface EditorRegistration {
  editorId: string;
  followPeer: (clientId: number) => void;
  scrollIntoView: () => void;
}

interface PresenceContextValue {
  peers: Peer[];
  connected: boolean;
  followPeer: (clientId: number) => void;
  registerEditor: (reg: EditorRegistration) => () => void;
  setLocalCurrentEditor: (editorId: string) => void;
  markActive: () => void;
}

const PresenceContext = createContext<PresenceContextValue | null>(null);

interface DocEntry {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  refCount: number;
  disposeTimer: ReturnType<typeof setTimeout> | null;
}

const presenceCache = new Map<string, DocEntry>();

function acquirePresence(
  pageId: string,
  token: string,
  onConnect: () => void,
  onDisconnect: () => void,
): DocEntry {
  const key = presenceRoomName(pageId);
  let entry = presenceCache.get(key);
  if (entry) {
    if (entry.disposeTimer) {
      clearTimeout(entry.disposeTimer);
      entry.disposeTimer = null;
    }
    entry.refCount++;
    return entry;
  }
  const ydoc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: getCollabUrl(),
    name: key,
    document: ydoc,
    token,
    onConnect,
    onDisconnect,
  });
  entry = { ydoc, provider, refCount: 1, disposeTimer: null };
  presenceCache.set(key, entry);
  return entry;
}

function releasePresence(pageId: string) {
  const key = presenceRoomName(pageId);
  const entry = presenceCache.get(key);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount > 0) return;
  // Delay destroy so StrictMode unmount+remount reuses the same instance.
  entry.disposeTimer = setTimeout(() => {
    const current = presenceCache.get(key);
    if (!current || current.refCount > 0) return;
    current.provider.destroy();
    current.ydoc.destroy();
    presenceCache.delete(key);
  }, 500);
}

function peersEqual(a: Peer[], b: Peer[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.clientId !== y.clientId ||
      x.name !== y.name ||
      x.color !== y.color ||
      x.idle !== y.idle ||
      x.isMe !== y.isMe ||
      x.currentEditor !== y.currentEditor ||
      x.userId !== y.userId ||
      x.photoUrl !== y.photoUrl ||
      x.subtitle !== y.subtitle
    ) {
      return false;
    }
  }
  return true;
}

interface PresenceProviderProps {
  pageId: string;
  token: string | null | undefined;
  userName: string;
  userColor?: string;
  userId?: string;
  photoUrl?: string | null;
  subtitle?: string | null;
  children: ReactNode;
}

export function PresenceProvider({
  pageId,
  token,
  userName,
  userColor,
  userId,
  photoUrl,
  subtitle,
  children,
}: PresenceProviderProps) {
  const [entry, setEntry] = useState<DocEntry | null>(null);
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const color = userColor ?? nameToColor(userName);

  // Latest values consumed by stable callbacks. Avoids re-running the
  // window-listener effect every time userName/color change, and lets
  // followPeer stay identity-stable across awareness ticks.
  const userNameRef = useRef(userName);
  const colorRef = useRef(color);
  const userIdRef = useRef(userId);
  const photoUrlRef = useRef(photoUrl);
  const subtitleRef = useRef(subtitle);
  const peersRef = useRef<Peer[]>([]);
  userNameRef.current = userName;
  colorRef.current = color;
  userIdRef.current = userId;
  photoUrlRef.current = photoUrl;
  subtitleRef.current = subtitle;
  peersRef.current = peers;

  const editorsRef = useRef(new Map<string, EditorRegistration>());

  useEffect(() => {
    if (!token) return;
    const acquired = acquirePresence(
      pageId,
      token,
      () => setConnected(true),
      () => setConnected(false),
    );
    setEntry(acquired);
    return () => {
      releasePresence(pageId);
      setEntry(null);
      setConnected(false);
    };
  }, [pageId, token]);

  useEffect(() => {
    if (!entry) return;
    const awareness = entry.provider.awareness!;
    const update = () => {
      const list: Peer[] = [];
      awareness.getStates().forEach((state, clientId) => {
        const u = state.user as AwarenessUser | undefined;
        if (!u) return;
        list.push({
          clientId,
          name: u.name,
          color: u.color,
          idle: !!u.idle,
          isMe: clientId === entry.ydoc.clientID,
          currentEditor: u.currentEditor,
          userId: u.userId,
          photoUrl: u.photoUrl ?? null,
          subtitle: u.subtitle ?? null,
        });
      });
      // Bail when shape-relevant fields are unchanged. Awareness fires on
      // every keystroke (lastActive bumps), but we only re-render when a
      // field the bar/follow-mode actually reads changes.
      setPeers((prev) => (peersEqual(prev, list) ? prev : list));
    };
    awareness.on("change", update);
    update();
    return () => {
      awareness.off("change", update);
    };
  }, [entry]);

  // Single source of truth for awareness writes. Stable identity (deps only
  // on `entry`) so dependent callbacks/effects don't tear down on rename.
  const lastBroadcastRef = useRef(0);
  const setUser = useCallback(
    (patch: Partial<AwarenessUser> = {}) => {
      if (!entry) return;
      const aw = entry.provider.awareness!;
      const cur = (aw.getLocalState()?.user ?? {}) as Partial<AwarenessUser>;
      aw.setLocalStateField("user", {
        lastActive: Date.now(),
        idle: false,
        ...cur,
        ...patch,
        name: userNameRef.current,
        color: colorRef.current,
        userId: userIdRef.current,
        photoUrl: photoUrlRef.current ?? null,
        subtitle: subtitleRef.current ?? null,
      } satisfies AwarenessUser);
    },
    [entry],
  );

  const markActive = useCallback(() => {
    const now = Date.now();
    if (now - lastBroadcastRef.current < ACTIVITY_THROTTLE_MS) return;
    lastBroadcastRef.current = now;
    setUser({ lastActive: now, idle: false });
  }, [setUser]);

  const setLocalCurrentEditor = useCallback(
    (editorId: string) => {
      const now = Date.now();
      lastBroadcastRef.current = now;
      setUser({ currentEditor: editorId, lastActive: now, idle: false });
    },
    [setUser],
  );

  // Initial broadcast + page-level activity tracking. Listening at the page
  // level (not just editor activity) so reading-without-typing still counts.
  useEffect(() => {
    if (!entry) return;
    setUser({ lastActive: Date.now(), idle: false });

    const onActivity = () => markActive();
    const onVisibility = () => {
      if (!document.hidden) markActive();
    };

    window.addEventListener("keydown", onActivity, { passive: true });
    window.addEventListener("mousemove", onActivity, { passive: true });
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("scroll", onActivity, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisibility);

    const aw = entry.provider.awareness!;
    const idleTimer = setInterval(() => {
      const cur = (aw.getLocalState()?.user ?? {}) as AwarenessUser;
      const isIdle = Date.now() - (cur.lastActive ?? 0) > IDLE_AFTER_MS;
      if (isIdle !== !!cur.idle) setUser({ idle: isIdle });
    }, IDLE_CHECK_MS);

    return () => {
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("scroll", onActivity, true);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(idleTimer);
    };
  }, [entry, setUser, markActive]);

  const registerEditor = useCallback((reg: EditorRegistration) => {
    editorsRef.current.set(reg.editorId, reg);
    return () => {
      // StrictMode-safe: only delete if the registration is still ours.
      if (editorsRef.current.get(reg.editorId) === reg) {
        editorsRef.current.delete(reg.editorId);
      }
    };
  }, []);

  // Stable identity — reads from peersRef, not the peers state slot — so
  // consumers of usePresence() don't re-render every awareness tick just
  // because followPeer's identity churned.
  const followPeer = useCallback((clientId: number) => {
    const peer = peersRef.current.find((p) => p.clientId === clientId);
    if (!peer || peer.isMe || !peer.currentEditor) return;
    const reg = editorsRef.current.get(peer.currentEditor);
    if (!reg) return;
    reg.scrollIntoView();
    reg.followPeer(clientId);
  }, []);

  const value = useMemo<PresenceContextValue>(
    () => ({
      peers,
      connected,
      followPeer,
      registerEditor,
      setLocalCurrentEditor,
      markActive,
    }),
    [peers, connected, followPeer, registerEditor, setLocalCurrentEditor, markActive],
  );

  return (
    <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>
  );
}

/**
 * Hook for editors to opt-in to page-level presence. No-op if there's no
 * provider in the tree (editor still works standalone). The followPeer and
 * scrollIntoView callbacks should be `useCallback`-stable; if they're not,
 * the editor will re-register on every render.
 */
export function useRegisterCollabEditor(args: {
  editorId: string;
  followPeer: (clientId: number) => void;
  scrollIntoView: () => void;
}): {
  enabled: boolean;
  reportFocus: () => void;
  markActive: () => void;
} {
  const ctx = useContext(PresenceContext);
  const { editorId, followPeer, scrollIntoView } = args;

  useEffect(() => {
    if (!ctx) return;
    return ctx.registerEditor({ editorId, followPeer, scrollIntoView });
  }, [ctx, editorId, followPeer, scrollIntoView]);

  const reportFocus = useCallback(() => {
    ctx?.setLocalCurrentEditor(editorId);
  }, [ctx, editorId]);

  const markActive = useCallback(() => {
    ctx?.markActive();
  }, [ctx]);

  return { enabled: !!ctx, reportFocus, markActive };
}

/** Read presence state. Returns null if no provider in tree. */
export function usePresence(): PresenceContextValue | null {
  return useContext(PresenceContext);
}
