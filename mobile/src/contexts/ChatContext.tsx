import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { api, errorMessage } from '../api/client';
import type { MemberSummary } from '../api/contract';
import { openEventStream } from '../api/sse';
import type { Conversation, Message } from '../types/chat';
import type { Presence, User } from '../types/user';
import { toChannelSlug } from '../utils/chat';
import { toMs } from '../utils/time';

interface CreateChannelInput {
  name: string;
  topic: string;
  isPrivate: boolean;
  memberIds: string[];
}

interface ChatContextValue {
  meId: string;
  users: User[];
  conversations: Conversation[];
  messages: Message[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getUser: (id: string) => User | undefined;
  sendMessage: (conversationId: string, text: string, parentId?: string) => void;
  toggleReaction: (messageId: string, emoji: string) => void;
  joinChannel: (conversationId: string) => void;
  leaveChannel: (conversationId: string) => void;
  createChannel: (input: CreateChannelInput) => Promise<string>;
  inviteMembers: (conversationId: string, userIds: string[]) => void;
  openDirectMessage: (userIds: string[]) => Promise<string>;
  markRead: (conversationId: string) => void;
  setPresence: (presence: Presence) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function toUser(m: MemberSummary): User {
  return { ...m, handle: m.handle ?? '' };
}

function mergeMessages(prev: Message[], incoming: Message[], dropIds: string[] = []) {
  const byId = new Map(prev.filter((m) => !dropIds.includes(m.id)).map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return Array.from(byId.values());
}

function upsertConversation(prev: Conversation[], c: Conversation) {
  return prev.some((x) => x.id === c.id) ? prev.map((x) => (x.id === c.id ? c : x)) : [...prev, c];
}

export function ChatProvider({ children, enabled, onPresenceChange }: { children: React.ReactNode; enabled: boolean; onPresenceChange?: (p: 'active' | 'away') => void }) {
  const [meId, setMeId] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const meRef = useRef('');
  const inflight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(() => {
    if (inflight.current) return inflight.current;
    setLoading(true);
    const run = (async () => {
      try {
        const data = await api.chatBootstrap();
        meRef.current = data.meId;
        setMeId(data.meId);
        setUsers(data.users.map(toUser));
        setConversations(data.conversations);
        setMessages((prev) => mergeMessages(prev.filter((m) => m.id.startsWith('tmp-')), data.messages));
        setError(null);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, []);

  useEffect(() => {
    if (!enabled) {
      meRef.current = '';
      setMeId('');
      setUsers([]);
      setConversations([]);
      setMessages([]);
      setError(null);
      return;
    }
    let close: (() => void) | null = openEventStream('/api/chat/stream', () => void refresh());
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh();
        if (!close) close = openEventStream('/api/chat/stream', () => void refresh());
      } else if (state === 'background') {
        close?.();
        close = null;
      }
    });
    return () => {
      sub.remove();
      close?.();
    };
  }, [enabled, refresh]);

  const getUser = useCallback((id: string) => users.find((u) => u.id === id), [users]);

  const sendMessage = useCallback((conversationId: string, text: string, parentId?: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    seq.current += 1;
    const tmp: Message = {
      id: `tmp-${seq.current}`,
      conversationId,
      authorId: meRef.current,
      text: trimmed,
      createdAt: new Date().toISOString(),
      reactions: [],
      parentId: parentId ?? null,
      kind: 'user',
    };
    setMessages((prev) => [...prev, tmp]);
    api
      .sendMessage(conversationId, trimmed, parentId)
      .then(({ message }) => setMessages((prev) => mergeMessages(prev, [message], [tmp.id])))
      .catch((err) => {
        setMessages((prev) => prev.filter((m) => m.id !== tmp.id));
        Alert.alert('Message not sent', errorMessage(err));
      });
  }, []);

  const toggleReaction = useCallback((messageId: string, emoji: string) => {
    const me = meRef.current;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const existing = m.reactions.find((r) => r.emoji === emoji);
        if (!existing) return { ...m, reactions: [...m.reactions, { emoji, userIds: [me] }] };
        const reacted = existing.userIds.includes(me);
        const reactions = m.reactions
          .map((r) => (r.emoji !== emoji ? r : { ...r, userIds: reacted ? r.userIds.filter((id) => id !== me) : [...r.userIds, me] }))
          .filter((r) => r.userIds.length > 0);
        return { ...m, reactions };
      }),
    );
    if (messageId.startsWith('tmp-')) return;
    api
      .toggleReaction(messageId, emoji)
      .then(({ message }) => setMessages((prev) => mergeMessages(prev, [message])))
      .catch(() => void refresh());
  }, [refresh]);

  const applyConversation = useCallback((conversation: Conversation, incoming: Message[] = []) => {
    setConversations((prev) => upsertConversation(prev, conversation));
    if (incoming.length) setMessages((prev) => mergeMessages(prev, incoming));
  }, []);

  const joinChannel = useCallback(
    (conversationId: string) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId && !c.memberIds.includes(meRef.current)
            ? { ...c, memberIds: [...c.memberIds, meRef.current], lastReadAt: new Date().toISOString() }
            : c,
        ),
      );
      api
        .joinChannel(conversationId)
        .then(({ conversation, messages: m }) => applyConversation(conversation, m))
        .catch(() => void refresh());
    },
    [applyConversation, refresh],
  );

  const leaveChannel = useCallback(
    (conversationId: string) => {
      setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, memberIds: c.memberIds.filter((id) => id !== meRef.current) } : c)));
      api.leaveChannel(conversationId).catch(() => void refresh());
    },
    [refresh],
  );

  const createChannel = useCallback(
    async (input: CreateChannelInput) => {
      const { conversation, messages: m } = await api.createChannel({
        name: toChannelSlug(input.name),
        topic: input.topic.trim() || undefined,
        isPrivate: input.isPrivate,
        memberIds: input.memberIds,
      });
      applyConversation(conversation, m);
      return conversation.id;
    },
    [applyConversation],
  );

  const inviteMembers = useCallback(
    (conversationId: string, userIds: string[]) => {
      if (userIds.length === 0) return;
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, memberIds: Array.from(new Set([...c.memberIds, ...userIds])) } : c)),
      );
      api
        .addMembers(conversationId, userIds)
        .then(({ conversation, messages: m }) => applyConversation(conversation, m))
        .catch(() => void refresh());
    },
    [applyConversation, refresh],
  );

  const openDirectMessage = useCallback(
    async (userIds: string[]) => {
      const memberIds = Array.from(new Set([meRef.current, ...userIds]));
      const key = [...memberIds].sort().join('|');
      const existing = conversations.find((c) => c.kind === 'dm' && [...c.memberIds].sort().join('|') === key);
      if (existing) return existing.id;
      const { conversation } = await api.openDm(userIds.filter((id) => id !== meRef.current));
      applyConversation(conversation);
      return conversation.id;
    },
    [conversations, applyConversation],
  );

  const markRead = useCallback(
    (conversationId: string) => {
      const latest = messages
        .filter((m) => m.conversationId === conversationId && !m.parentId && !m.id.startsWith('tmp-'))
        .reduce((max, m) => Math.max(max, toMs(m.createdAt)), 0);
      if (!latest) return;
      const target = conversations.find((c) => c.id === conversationId);
      if (!target || toMs(target.lastReadAt) >= latest) return;
      const at = new Date(latest).toISOString();
      setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, lastReadAt: at } : c)));
      api.markRead(conversationId, at).catch(() => {});
    },
    [messages, conversations],
  );

  const setPresence = useCallback(
    (presence: Presence) => {
      if (presence === 'offline') return;
      const me = meRef.current;
      const previous = users.find((u) => u.id === me)?.presence;
      setUsers((prev) => prev.map((u) => (u.id === me ? { ...u, presence } : u)));
      onPresenceChange?.(presence);
      api.setStatus(presence).catch(() => {
        if (previous) setUsers((prev) => prev.map((u) => (u.id === me ? { ...u, presence: previous } : u)));
        if (previous && previous !== 'offline') onPresenceChange?.(previous);
      });
    },
    [users, onPresenceChange],
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      meId,
      users,
      conversations,
      messages,
      loading,
      error,
      refresh,
      getUser,
      sendMessage,
      toggleReaction,
      joinChannel,
      leaveChannel,
      createChannel,
      inviteMembers,
      openDirectMessage,
      markRead,
      setPresence,
    }),
    [meId, users, conversations, messages, loading, error, refresh, getUser, sendMessage, toggleReaction, joinChannel, leaveChannel, createChannel, inviteMembers, openDirectMessage, markRead, setPresence],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
