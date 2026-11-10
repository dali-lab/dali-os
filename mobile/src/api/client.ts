import Constants from 'expo-constants';
import type {
  AddTimeEntryBody,
  CalendarResponse,
  CreateEventBody,
  MemberSummary,
  MeResponse,
  NoteDetail,
  NotePage,
  Notebook,
  NotesResponse,
  PassResponse,
  ProjectBoardResponse,
  ProjectsResponse,
  RecordingState,
  TaskStatus,
  TimeResponse,
} from './contract';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown = null,
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

async function request<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
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
    throw new ApiError(res.status, message, data);
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
  setStatus: (status: 'active' | 'away') => request<{ ok: true }>('PUT', '/api/mobile/me', { status }),
  projects: () => request<ProjectsResponse>('GET', '/api/mobile/projects'),
  projectBoard: (id: string) => request<ProjectBoardResponse>('GET', `/api/mobile/projects/${encodeURIComponent(id)}`),
  moveTask: (id: string, status: TaskStatus) =>
    request<{ ok: true }>('POST', `/api/tasks/${encodeURIComponent(id)}/move`, { status, position: 0 }),
  calendar: (from: Date, to: Date) =>
    request<CalendarResponse>('GET', `/api/mobile/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
  rsvp: (notificationId: string, response: 'accepted' | 'declined' | 'tentative') =>
    request<{ ok: true }>('POST', `/api/notifications/${encodeURIComponent(notificationId)}/rsvp`, { response }),
  createEvent: (body: CreateEventBody) =>
    request<{ id: string; addedToGoogle: boolean; googleError: string | null }>('POST', '/api/mobile/calendar', body),
  people: (q: string) => request<{ people: MemberSummary[] }>('GET', `/api/mobile/people?q=${encodeURIComponent(q)}`),
  pass: () => request<PassResponse>('GET', '/api/mobile/pass'),
  googleWalletUrl: () => request<{ url: string }>('GET', '/api/wallet/google/save-url'),

  time: (date?: string) => request<TimeResponse>('GET', `/api/mobile/time${date ? `?date=${date}` : ''}`),
  addTimeEntry: (body: AddTimeEntryBody) => request<{ id: string }>('POST', '/api/mobile/time', body),
  updateTimeEntry: (id: string, body: Partial<Omit<AddTimeEntryBody, 'scheduledMeetingId'>>) =>
    request<{ ok: true }>('PATCH', `/api/mobile/time/${encodeURIComponent(id)}`, body),
  deleteTimeEntry: (id: string) => request<{ ok: true }>('DELETE', `/api/mobile/time/${encodeURIComponent(id)}`),

  notes: (cursor?: string) => request<NotesResponse>('GET', `/api/mobile/notes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  note: (id: string) => request<NoteDetail>('GET', `/api/mobile/notes/${encodeURIComponent(id)}`),
  personalNotePage: (title: string) => request<NotePage>('POST', '/api/mobile/notes', { title }),
  meetingNotePage: (scheduledMeetingId: string, occurrenceStart: string) =>
    request<NotePage>('POST', '/api/mobile/notes', { scheduledMeetingId, occurrenceStart }),
  notebooks: (q: string) => request<{ notebooks: Notebook[] }>('GET', `/api/notebooks?q=${encodeURIComponent(q)}`),
  newNotebookNote: (notebookId: string) =>
    request<{ id: string }>('POST', `/api/notebooks/${encodeURIComponent(notebookId)}`, { intent: 'new-note' }),
  editorSignIn: (pageId: string) => request<{ url: string }>('POST', '/api/mobile/webview', { pageId }),
  enhanceNote: (id: string) => request<{ ok: true }>('POST', `/api/mobile/notes/${encodeURIComponent(id)}`, { action: 'enhance' }),

  startRecording: (target: { scheduledMeetingId: string; occurrenceStart: string } | { documentName: string }) =>
    request<{ id: string }>('POST', '/api/meeting-recordings', target),
  recording: (id: string) => request<RecordingState>('GET', `/api/meeting-recordings/${encodeURIComponent(id)}`),
  recordingAction: (id: string, body: Record<string, unknown>) =>
    request<Record<string, unknown>>('POST', `/api/meeting-recordings/${encodeURIComponent(id)}`, body),
  discardRecording: (id: string) => request<{ ok: true }>('DELETE', `/api/meeting-recordings/${encodeURIComponent(id)}`),
  createTasks: (id: string, items: { index: number; title: string; assigneeId?: string; dueAt?: string }[]) =>
    request<{ created: { index: number; taskId: string }[] }>('POST', `/api/meeting-recordings/${encodeURIComponent(id)}`, {
      action: 'createTasks',
      items,
    }),
};

/** One 20s PCM chunk. 409 means the recording already ended on the server. */
export async function uploadChunk(
  recordingId: string,
  chunk: { segment: number; seq: number; pcm: ArrayBuffer },
): Promise<{ stopRequested: boolean }> {
  const path = `/api/meeting-recordings/${encodeURIComponent(recordingId)}/chunks?channel=mic&segment=${chunk.segment}&seq=${chunk.seq}`;
  const res = await fetch(`${config.baseUrl}${path}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'audio/pcm;rate=16000;channels=1' },
    body: chunk.pcm,
    credentials: 'omit',
  });
  if (!res.ok) throw new ApiError(res.status, `Chunk upload failed (${res.status})`);
  return (await res.json()) as { stopRequested: boolean };
}

export function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : 'Something went wrong.';
}
