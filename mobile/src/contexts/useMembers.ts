import { useCallback } from 'react';
import type { MemberSummary } from '../api/contract';
import type { User } from '../types/user';
import { useData } from './DataContext';

export function toUser(m: MemberSummary): User {
  return { ...m, handle: m.handle ?? '' };
}

export function useMembers() {
  const { board, me, people } = useData();
  const meId = me.data?.user.id ?? '';
  const getMember = useCallback(
    (id: string): User | undefined => {
      if (me.data && me.data.user.id === id) return toUser(me.data.user);
      const known = people[id] ?? board.data?.members.find((m) => m.id === id);
      return known ? toUser(known) : undefined;
    },
    [people, board.data, me.data],
  );
  return { getMember, meId };
}
