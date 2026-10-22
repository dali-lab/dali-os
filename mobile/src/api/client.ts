import Constants from 'expo-constants';
import type {
  ChatBootstrapResponse,
  CalendarResponse,
  Conversation,
  MeResponse,
  Message,
  PassResponse,
  ProjectBoardResponse,
  ProjectsResponse,
  TaskStatus,
} from './contract';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface ClientConfig {
  baseUrl: string;
  token: string | null;
  onUnauthorized: () => void;
}

let config: ClientConfig = { baseUrl: '', token: null, onUnauthorized: () => {} };

export function configureClient(next: Partial<ClientConfig>) {
  config = { ...config, ...next };
}

export function clientConfig() {
  return config;
}

const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

export function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-DaliOS-App-Version': APP_VERSION };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  return headers;
}

async function request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const headers = authHeaders();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
    });
  } catch {
    throw new ApiError(0, 'Can’t reach DALI OS. Check your connection.');
  }
  if (res.status === 401 && config.token) {
    config.onUnauthorized();
    throw new ApiError(401, 'Your session ended. Sign in again.');
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export type PairStart = { deviceCode: string; userCode: string; verificationUrl: string; expiresIn: number; interval: number };
export type PairPoll =
  | { status: 'pending' | 'slow_down'; interval?: number }
  | { status: 'denied' | 'expired' | 'already_used' }
  | { status: 'approved'; desktopToken: string };

export const api = {
  pairStart: (deviceLabel: string) => request<PairStart>('POST', '/auth/pair/start', { deviceLabel }),
  pairPoll: (deviceCode: string) => request<PairPoll>('POST', '/auth/pair/poll', { deviceCode }),
  logout: () => request<unknown>('GET', '/logout').catch(() => null),

  me: () => request<MeResponse>('GET', '/api/mobile/me'),
  setStatus: (status: 'active' | 'away') => request<{ ok: true }>('PUT', '/api/mobile/me/status', { status }),
  projects: () => request<ProjectsResponse>('GET', '/api/mobile/projects'),
  projectBoard: (id: string) => request<ProjectBoardResponse>('GET', `/api/mobile/projects/${encodeURIComponent(id)}`),
  moveTask: (id: string, status: TaskStatus) =>
    request<{ ok: true }>('POST', `/api/tasks/${encodeURIComponent(id)}/move`, { status, position: 0 }),
  calendar: (from: Date, to: Date) =>
    request<CalendarResponse>('GET', `/api/mobile/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
  rsvp: (notificationId: string, response: 'accepted' | 'declined' | 'tentative') =>
    request<{ ok: true }>('POST', `/api/notifications/${encodeURIComponent(notificationId)}/rsvp`, { response }),
  pass: () => request<PassResponse>('GET', '/api/mobile/pass'),
  registerPushToken: (token: string, platform: 'ios' | 'android') =>
    request<{ ok: true }>('POST', '/api/mobile/push-token', { token, platform }),
  unregisterPushToken: (token: string) => request<{ ok: true }>('DELETE', '/api/mobile/push-token', { token }),
  googleWalletUrl: () => request<{ url: string }>('GET', '/api/wallet/google/save-url'),

  chatBootstrap: () => request<ChatBootstrapResponse>('GET', '/api/chat/bootstrap'),
  olderMessages: (conversationId: string, before: string) =>
    request<{ messages: Message[] }>(
      'GET',
      `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages?before=${encodeURIComponent(before)}`,
    ),
  sendMessage: (conversationId: string, text: string, parentId?: string) =>
    request<{ message: Message }>('POST', `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`, { text, parentId }),
  toggleReaction: (messageId: string, emoji: string) =>
    request<{ message: Message }>('POST', `/api/chat/messages/${encodeURIComponent(messageId)}/reactions`, { emoji }),
  createChannel: (input: { name: string; topic?: string; isPrivate: boolean; memberIds: string[] }) =>
    request<{ conversation: Conversation; messages: Message[] }>('POST', '/api/chat/conversations', input),
  openDm: (userIds: string[]) => request<{ conversation: Conversation }>('POST', '/api/chat/dms', { userIds }),
  joinChannel: (id: string) =>
    request<{ conversation: Conversation; messages: Message[] }>('POST', `/api/chat/conversations/${encodeURIComponent(id)}/join`),
  leaveChannel: (id: string) => request<{ ok: true }>('POST', `/api/chat/conversations/${encodeURIComponent(id)}/leave`),
  addMembers: (id: string, userIds: string[]) =>
    request<{ conversation: Conversation; messages: Message[] }>('POST', `/api/chat/conversations/${encodeURIComponent(id)}/members`, { userIds }),
  markRead: (id: string, at: string) => request<{ ok: true }>('POST', `/api/chat/conversations/${encodeURIComponent(id)}/read`, { at }),
};

export function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : 'Something went wrong.';
}
