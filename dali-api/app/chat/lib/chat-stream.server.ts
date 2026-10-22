export type ChatStreamEvent = "message" | "conversation";
type Subscriber = (event: ChatStreamEvent, conversationId: string) => void;

const g = globalThis as unknown as { __chatStreamSubs?: Map<string, Set<Subscriber>> };
const registry = g.__chatStreamSubs ?? new Map<string, Set<Subscriber>>();
if (!g.__chatStreamSubs) g.__chatStreamSubs = registry;

export function subscribeToChat(userId: string, onEvent: Subscriber): () => void {
  let set = registry.get(userId);
  if (!set) {
    set = new Set();
    registry.set(userId, set);
  }
  set.add(onEvent);
  return () => {
    const s = registry.get(userId);
    if (!s) return;
    s.delete(onEvent);
    if (s.size === 0) registry.delete(userId);
  };
}

export function publishChatEvent(userIds: string[], event: ChatStreamEvent, conversationId: string): void {
  for (const userId of new Set(userIds)) {
    const set = registry.get(userId);
    if (!set) continue;
    for (const fn of set) {
      try {
        fn(event, conversationId);
      } catch {
        // a closed stream cleans up its own subscription
      }
    }
  }
}
