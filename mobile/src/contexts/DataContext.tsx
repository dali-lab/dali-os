import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { addDays, startOfWeek } from 'date-fns';
import { api, errorMessage } from '../api/client';
import type { MeResponse, MemberSummary, PassResponse, ProjectBoardResponse, ProjectSummary } from '../api/contract';
import type { CalendarEvent, Rsvp } from '../types/calendar';
import type { TaskStatus } from '../types/project';

export interface Resource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

const idle = <T,>(): Resource<T> => ({ data: null, loading: false, error: null });

export const weekKey = (weekStart: Date) => startOfWeek(weekStart).toISOString();

interface DataContextValue {
  me: Resource<MeResponse>;
  projects: Resource<ProjectSummary[]>;
  board: Resource<ProjectBoardResponse>;
  selectedProjectId: string | null;
  pass: Resource<PassResponse>;
  weeks: Record<string, Resource<CalendarEvent[]>>;
  /** Attendees of every loaded calendar week, by id. */
  people: Record<string, MemberSummary>;
  loadMe: () => Promise<void>;
  loadProjects: () => Promise<void>;
  selectProject: (id: string) => Promise<void>;
  loadPass: () => Promise<void>;
  loadWeek: (weekStart: Date) => Promise<void>;
  changeTaskStatus: (taskId: string, status: TaskStatus) => Promise<void>;
  setRsvp: (event: CalendarEvent, rsvp: Rsvp) => Promise<void>;
  setPresence: (presence: 'active' | 'away') => void;
  reset: () => void;
}

const DataContext = createContext<DataContextValue | null>(null);

async function track<T>(set: React.Dispatch<React.SetStateAction<Resource<T>>>, load: () => Promise<T>) {
  set((r) => ({ ...r, loading: true, error: null }));
  try {
    const data = await load();
    set({ data, loading: false, error: null });
    return data;
  } catch (err) {
    set((r) => ({ ...r, loading: false, error: errorMessage(err) }));
    return null;
  }
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Resource<MeResponse>>(idle);
  const [projects, setProjects] = useState<Resource<ProjectSummary[]>>(idle);
  const [board, setBoard] = useState<Resource<ProjectBoardResponse>>(idle);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [pass, setPass] = useState<Resource<PassResponse>>(idle);
  const [weeks, setWeeks] = useState<Record<string, Resource<CalendarEvent[]>>>({});
  const [people, setPeople] = useState<Record<string, MemberSummary>>({});
  const selectedRef = useRef<string | null>(null);

  const loadMe = useCallback(async () => {
    await track(setMe, api.me);
  }, []);

  const loadBoard = useCallback(async (id: string) => {
    await track(setBoard, () => api.projectBoard(id));
  }, []);

  const selectProject = useCallback(
    async (id: string) => {
      selectedRef.current = id;
      setSelectedProjectId(id);
      await loadBoard(id);
    },
    [loadBoard],
  );

  const loadProjects = useCallback(async () => {
    const list = await track(setProjects, async () => (await api.projects()).projects);
    if (!list) {
      setBoard((b) => ({ ...b, error: b.data ? b.error : 'Couldn’t load your projects.' }));
      return;
    }
    const keep = list.find((p) => p.id === selectedRef.current) ?? list[0];
    if (!keep) {
      selectedRef.current = null;
      setSelectedProjectId(null);
      setBoard(idle);
      return;
    }
    await selectProject(keep.id);
  }, [selectProject]);

  const loadPass = useCallback(async () => {
    await track(setPass, api.pass);
  }, []);

  const loadWeek = useCallback(async (weekStart: Date) => {
    const key = weekKey(weekStart);
    const from = new Date(key);
    setWeeks((w) => ({ ...w, [key]: { data: w[key]?.data ?? null, loading: true, error: null } }));
    try {
      const { events, people: attendees } = await api.calendar(from, addDays(from, 7));
      setPeople((p) => ({ ...p, ...Object.fromEntries((attendees ?? []).map((m) => [m.id, m])) }));
      setWeeks((w) => ({ ...w, [key]: { data: events, loading: false, error: null } }));
    } catch (err) {
      setWeeks((w) => ({ ...w, [key]: { data: w[key]?.data ?? null, loading: false, error: errorMessage(err) } }));
    }
  }, []);

  const changeTaskStatus = useCallback(
    async (taskId: string, status: TaskStatus) => {
      let previous: TaskStatus | null = null;
      const apply = (s: TaskStatus | null) =>
        setBoard((b) => {
          if (!b.data || !s) return b;
          const tasks = b.data.tasks.map((t) => {
            if (t.id !== taskId) return t;
            previous = previous ?? t.status;
            return { ...t, status: s };
          });
          const doneCount = tasks.filter((t) => t.status === 'Done').length;
          const wasDone = b.data.tasks.filter((t) => t.status === 'Done').length;
          return { ...b, data: { ...b.data, tasks, project: { ...b.data.project, doneCount: b.data.project.doneCount + doneCount - wasDone } } };
        });
      apply(status);
      try {
        await api.moveTask(taskId, status);
      } catch (err) {
        apply(previous);
        setBoard((b) => ({ ...b, error: errorMessage(err) }));
      }
    },
    [],
  );

  const setRsvp = useCallback(async (event: CalendarEvent, rsvp: Rsvp) => {
    const patch = (value: Rsvp) =>
      setWeeks((w) => {
        const next = { ...w };
        for (const key of Object.keys(next)) {
          const res = next[key];
          if (res.data?.some((e) => e.id === event.id)) {
            next[key] = { ...res, data: res.data.map((e) => (e.id === event.id ? { ...e, rsvp: value } : e)) };
          }
        }
        return next;
      });
    if (!event.rsvpNotificationId || rsvp === 'needs_action') return;
    patch(rsvp);
    try {
      await api.rsvp(event.rsvpNotificationId, rsvp);
    } catch {
      patch(event.rsvp);
    }
  }, []);

  const setPresence = useCallback((presence: 'active' | 'away') => {
    let previous: MeResponse['user']['presence'] | null = null;
    const apply = (value: MeResponse['user']['presence']) =>
      setMe((m) => {
        if (!m.data) return m;
        previous = previous ?? m.data.user.presence;
        return { ...m, data: { ...m.data, user: { ...m.data.user, presence: value } } };
      });
    apply(presence);
    api.setStatus(presence).catch(() => {
      if (previous) apply(previous);
    });
  }, []);

  const reset = useCallback(() => {
    selectedRef.current = null;
    setMe(idle);
    setProjects(idle);
    setBoard(idle);
    setSelectedProjectId(null);
    setPass(idle);
    setWeeks({});
    setPeople({});
  }, []);

  const value = useMemo<DataContextValue>(
    () => ({
      me,
      projects,
      board,
      selectedProjectId,
      pass,
      weeks,
      people,
      loadMe,
      loadProjects,
      selectProject,
      loadPass,
      loadWeek,
      changeTaskStatus,
      setRsvp,
      setPresence,
      reset,
    }),
    [me, projects, board, selectedProjectId, pass, weeks, people, loadMe, loadProjects, selectProject, loadPass, loadWeek, changeTaskStatus, setRsvp, setPresence, reset],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
