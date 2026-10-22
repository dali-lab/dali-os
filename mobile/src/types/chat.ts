export type { Conversation, Message, Reaction } from '../api/contract';

export type ChatRoute =
  | { name: 'conversation'; id: string }
  | { name: 'thread'; conversationId: string; messageId: string }
  | { name: 'details'; id: string };
