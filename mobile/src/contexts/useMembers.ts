import { useCallback } from 'react';
import type { User } from '../types/user';
import { toUser, useChat } from './ChatContext';
import { useData } from './DataContext';

export function useMembers() {
  const { getUser } = useChat();
  const { board, me } = useData();
  const meId = me.data?.user.id ?? '';
  const getMember = useCallback(
    (id: string): User | undefined => {
      const fromChat = getUser(id);
      if (fromChat) return fromChat;
      const fromBoard = board.data?.members.find((m) => m.id === id);
      if (fromBoard) return toUser(fromBoard);
      if (me.data && me.data.user.id === id) return toUser(me.data.user);
      return undefined;
    },
    [getUser, board.data, me.data],
  );
  return { getMember, meId };
}
