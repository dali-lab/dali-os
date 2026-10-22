import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { api, errorMessage } from '../api/client';
import type { Role, TimeEntry, TimeResponse } from '../api/contract';
import { formatHours, hoursBetween, toDateKey } from '../utils/hours';

/** Taps shorter than this are treated as accidental and not logged. */
const MIN_TIMER_SECONDS = 5;
const TIMER_KEY = 'dali.timer';

export interface RunningTimer {
  roleRefId: string;
  note: string;
  startedAt: string;
}

export interface EntryInput {
  roleRefId: string;
  start: Date;
  end: Date;
  note: string;
}

interface TimeContextValue {
  data: TimeResponse | null;
  loading: boolean;
  error: string | null;
  roles: Role[];
  entries: TimeEntry[];
  timer: RunningTimer | null;
  getRole: (roleRefId: string | null) => Role | undefined;
  load: () => Promise<void>;
  startTimer: (roleRefId?: string, note?: string) => void;
  updateTimer: (patch: Partial<Pick<RunningTimer, 'roleRefId' | 'note'>>) => void;
  /** Clocks out and logs the entry; resolves to the message to show. Throws if saving failed (the timer keeps running). */
  stopTimer: () => Promise<string>;
  discardTimer: () => void;
  addEntry: (input: EntryInput) => Promise<void>;
  updateEntry: (entry: TimeEntry, input: EntryInput) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  /** The member's hours for one meeting occurrence, from any loaded pay period. */
  meetingEntry: (meetingId: string, occurrenceStart: string) => TimeEntry | undefined;
  /** Loads the pay period containing `dayKey` so `meetingEntry` can see it. */
  ensurePeriodFor: (dayKey: string) => void;
  logMeeting: (meeting: { id: string; start: string; end: string }) => Promise<void>;
  reset: () => void;
}

const TimeContext = createContext<TimeContextValue | null>(null);

const covers = (r: TimeResponse, dayKey: string) => dayKey >= r.period.start && dayKey <= r.period.end;

function saveTimer(timer: RunningTimer | null) {
  const write = timer ? SecureStore.setItemAsync(TIMER_KEY, JSON.stringify(timer)) : SecureStore.deleteItemAsync(TIMER_KEY);
  write.catch(() => {});
}

export function TimeProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<TimeResponse | null>(null);
  const [others, setOthers] = useState<TimeResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timer, setTimerState] = useState<RunningTimer | null>(null);
  const requested = useRef(new Set<string>());

  useEffect(() => {
    SecureStore.getItemAsync(TIMER_KEY)
      .then((raw) => {
        if (raw) setTimerState((t) => t ?? (JSON.parse(raw) as RunningTimer));
      })
      .catch(() => {});
  }, []);

  const setTimer = useCallback((next: RunningTimer | null) => {
    setTimerState(next);
    saveTimer(next);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.time());
      setOthers([]);
      requested.current.clear();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const roles = useMemo(() => data?.roles ?? [], [data]);
  const entries = useMemo(() => data?.entries ?? [], [data]);
  const getRole = useCallback((id: string | null) => roles.find((r) => r.roleRefId === id), [roles]);

  const startTimer = useCallback(
    (roleRefId?: string, note = '') => {
      const role = roleRefId ?? roles[0]?.roleRefId;
      if (!role || timer) return;
      setTimer({ roleRefId: role, note, startedAt: new Date().toISOString() });
    },
    [roles, timer, setTimer],
  );

  const updateTimer = useCallback(
    (patch: Partial<Pick<RunningTimer, 'roleRefId' | 'note'>>) => {
      if (timer) setTimer({ ...timer, ...patch });
    },
    [timer, setTimer],
  );

  const discardTimer = useCallback(() => setTimer(null), [setTimer]);

  const save = useCallback(
    async (input: EntryInput, scheduledMeetingId?: string) => {
      const role = getRole(input.roleRefId);
      if (!role) throw new Error('Pick a role.');
      await api.addTimeEntry({
        date: toDateKey(input.start),
        hours: hoursBetween(input.start, input.end),
        assignmentType: role.assignmentType,
        roleRefId: role.roleRefId,
        note: input.note.trim() || null,
        startTime: input.start.toISOString(),
        endTime: input.end.toISOString(),
        scheduledMeetingId,
      });
    },
    [getRole],
  );

  const stopTimer = useCallback(async () => {
    if (!timer) return '';
    const start = new Date(timer.startedAt);
    const end = new Date();
    if ((end.getTime() - start.getTime()) / 1000 < MIN_TIMER_SECONDS) {
      setTimer(null);
      return 'Under 5 seconds, nothing logged';
    }
    await save({ roleRefId: timer.roleRefId, start, end, note: timer.note });
    setTimer(null);
    await load();
    return `Logged ${formatHours(hoursBetween(start, end))} to ${getRole(timer.roleRefId)?.label ?? 'your timesheet'}`;
  }, [timer, save, setTimer, load, getRole]);

  const addEntry = useCallback(
    async (input: EntryInput) => {
      await save(input);
      await load();
    },
    [save, load],
  );

  const updateEntry = useCallback(
    async (entry: TimeEntry, input: EntryInput) => {
      const role = getRole(input.roleRefId);
      if (!role) throw new Error('Pick a role.');
      const note = input.note.trim() || null;
      // A meeting's hours follow the meeting; only the role and note are the member's to change.
      await api.updateTimeEntry(
        entry.id,
        entry.source === 'Meeting'
          ? { assignmentType: role.assignmentType, roleRefId: role.roleRefId, note }
          : {
              date: toDateKey(input.start),
              hours: hoursBetween(input.start, input.end),
              assignmentType: role.assignmentType,
              roleRefId: role.roleRefId,
              note,
              startTime: input.start.toISOString(),
              endTime: input.end.toISOString(),
            },
      );
      await load();
    },
    [getRole, load],
  );

  const deleteEntry = useCallback(
    async (id: string) => {
      await api.deleteTimeEntry(id);
      await load();
    },
    [load],
  );

  const meetingEntry = useCallback(
    (meetingId: string, occurrenceStart: string) => {
      const at = new Date(occurrenceStart).getTime();
      return [data, ...others]
        .flatMap((r) => r?.entries ?? [])
        .find((e) => e.scheduledMeetingId === meetingId && e.occurrenceStart && new Date(e.occurrenceStart).getTime() === at);
    },
    [data, others],
  );

  const ensurePeriodFor = useCallback(
    (dayKey: string) => {
      if (!data || covers(data, dayKey) || others.some((r) => covers(r, dayKey)) || requested.current.has(dayKey)) return;
      requested.current.add(dayKey);
      api
        .time(dayKey)
        .then((r) => setOthers((prev) => [...prev.filter((p) => p.period.start !== r.period.start), r]))
        .catch(() => requested.current.delete(dayKey));
    },
    [data, others],
  );

  const logMeeting = useCallback(
    async (meeting: { id: string; start: string; end: string }) => {
      const roleRefId = timer?.roleRefId ?? roles[0]?.roleRefId;
      if (!roleRefId) throw new Error('You have no role to log hours to this term.');
      await save({ roleRefId, start: new Date(meeting.start), end: new Date(meeting.end), note: '' }, meeting.id);
      await load();
    },
    [timer, roles, save, load],
  );

  const reset = useCallback(() => {
    setData(null);
    setOthers([]);
    setError(null);
    requested.current.clear();
    setTimer(null);
  }, [setTimer]);

  const value = useMemo<TimeContextValue>(
    () => ({
      data,
      loading,
      error,
      roles,
      entries,
      timer,
      getRole,
      load,
      startTimer,
      updateTimer,
      stopTimer,
      discardTimer,
      addEntry,
      updateEntry,
      deleteEntry,
      meetingEntry,
      ensurePeriodFor,
      logMeeting,
      reset,
    }),
    [data, loading, error, roles, entries, timer, getRole, load, startTimer, updateTimer, stopTimer, discardTimer, addEntry, updateEntry, deleteEntry, meetingEntry, ensurePeriodFor, logMeeting, reset],
  );

  return <TimeContext.Provider value={value}>{children}</TimeContext.Provider>;
}

export function useTime(): TimeContextValue {
  const ctx = useContext(TimeContext);
  if (!ctx) throw new Error('useTime must be used inside TimeProvider');
  return ctx;
}
