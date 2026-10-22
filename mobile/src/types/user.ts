import type { MemberSummary } from '../api/contract';

export type { Presence, MeResponse } from '../api/contract';

export interface User extends Omit<MemberSummary, 'handle'> {
  handle: string;
}
