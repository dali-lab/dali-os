import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { type AvatarStatus } from "~/lib/presence";

// 60s poll interval matches the server-side throttle so we don't pay for
// writes that won't produce a new state.
const POLL_INTERVAL_MS = 60_000;

interface PresenceStatusContextValue {
  /** Current status for a given userId, or undefined while loading. */
  getStatus: (userId: string) => AvatarStatus | undefined;
  /** Called by Avatar to register a userId. Returns a cleanup fn. */
  register: (userId: string) => () => void;
  /** Current user's id — always shown as "active" without a fetch. */
  currentUserId: string | null;
}

const PresenceStatusContext = createContext<PresenceStatusContextValue | null>(null);

export function PresenceStatusProvider({
  currentUserId,
  children,
}: {
  currentUserId: string | null;
  children: ReactNode;
}) {
  // Ref-counted set so we know which ids need to be polled.
  const registeredRef = useRef(new Map<string, number>()); // userId → refCount
  const [statuses, setStatuses] = useState<Map<string, AvatarStatus>>(new Map());

  const fetch60s = useCallback(async () => {
    const ids = [...registeredRef.current.keys()].filter(
      (id) => id !== currentUserId,
    );
    if (ids.length === 0) return;
    try {
      const res = await fetch(`/api/presence/statuses?ids=${ids.join(",")}`);
      if (!res.ok) return;
      const data = (await res.json()) as Record<string, AvatarStatus>;
      setStatuses((prev) => {
        const next = new Map(prev);
        for (const [id, status] of Object.entries(data)) {
          next.set(id, status);
        }
        return next;
      });
    } catch {
      // Network errors are silent — stale state is fine.
    }
  }, [currentUserId]);

  useEffect(() => {
    // Initial fetch then every 60s.
    void fetch60s();
    const timer = setInterval(fetch60s, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetch60s]);

  const register = useCallback((userId: string) => {
    const map = registeredRef.current;
    map.set(userId, (map.get(userId) ?? 0) + 1);
    return () => {
      const count = (map.get(userId) ?? 1) - 1;
      if (count <= 0) map.delete(userId);
      else map.set(userId, count);
    };
  }, []);

  const getStatus = useCallback(
    (userId: string): AvatarStatus | undefined => {
      // Own user is always shown as active without waiting for a fetch.
      if (userId === currentUserId) {
        return { state: "active", lastActiveAt: null };
      }
      return statuses.get(userId);
    },
    [statuses, currentUserId],
  );

  return (
    <PresenceStatusContext.Provider value={{ getStatus, register, currentUserId }}>
      {children}
    </PresenceStatusContext.Provider>
  );
}

/**
 * Returns the live AvatarStatus for a userId, registering it for the 60s
 * poll. Returns undefined when no provider is in the tree (graceful degrades).
 */
export function useAvatarStatus(userId: string | undefined): AvatarStatus | undefined {
  const ctx = useContext(PresenceStatusContext);

  useEffect(() => {
    if (!ctx || !userId) return;
    return ctx.register(userId);
  }, [ctx, userId]);

  if (!ctx || !userId) return undefined;
  return ctx.getStatus(userId);
}
