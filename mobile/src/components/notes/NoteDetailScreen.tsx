import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { format } from 'date-fns';
import { Check, CheckCircle2, ExternalLink, Flag, RefreshCw, Sparkles, Timer } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import { api, clientConfig, errorMessage } from '../../api/client';
import type { NoteDetail, OutlineItem } from '../../api/contract';
import { useNotes } from '../../contexts/NotesContext';
import { useTime } from '../../contexts/TimeContext';
import { formatHours, formatRecordedLength, formatTimestamp, hoursBetween } from '../../utils/hours';
import { formatShortDate } from '../../utils/time';
import { NavHeader } from '../NavHeader';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Eyebrow } from '../ui/Eyebrow';
import { ErrorState, LoadingState } from '../ui/StateViews';
import { Tag } from '../ui/Tag';
import { Text } from '../ui/Text';
import { Toast } from '../ui/Toast';

const SPEAKER_COLORS = [colors.teal, colors.purple, colors.coral, colors.navy, colors.green];

const STATUS_MESSAGE: Record<string, string> = {
  Pending: 'This recording hasn’t started yet.',
  Recording: 'This meeting is still being recorded.',
  Stopped: 'This recording is paused. Finish it from the device that recorded it.',
  Processing: 'Transcribing. Your notes will be ready in a few minutes.',
};

function Outline({ items }: { items: OutlineItem[] }) {
  let section = '';
  return (
    <View>
      {items.map((item, i) => {
        if (item.kind === 'heading') {
          section = item.text;
          return (
            <Eyebrow key={i} style={tw`mt-5`}>
              {item.text}
            </Eyebrow>
          );
        }
        const indent = { marginLeft: item.depth * 14 };
        if (/decision/i.test(section) && item.kind !== 'text') {
          return (
            <View key={i} style={[tw`mt-1.5 flex-row gap-2 rounded-xl bg-light-yellow/60 px-3 py-2`, indent]}>
              <Flag size={14} color={colors.darkNavy} style={tw`mt-0.5`} />
              <Text style={tw`flex-1 text-sm text-cool-black`}>{item.text}</Text>
            </View>
          );
        }
        if (item.kind === 'text') {
          return (
            <Text key={i} style={[tw`mt-1.5 text-[15px] leading-relaxed text-dark-gray`, indent]}>
              {item.text}
            </Text>
          );
        }
        return (
          <View key={i} style={[tw`mt-1.5 flex-row gap-2`, indent]}>
            {item.kind === 'check' ? (
              <View style={[tw`mt-0.5 h-4 w-4 items-center justify-center rounded border`, item.checked ? tw`border-teal bg-teal` : tw`border-slate-300`]}>
                {item.checked ? <Check size={10} color={colors.white} strokeWidth={3} /> : null}
              </View>
            ) : (
              <View style={tw`mt-[7px] h-1.5 w-1.5 rounded-full bg-teal`} />
            )}
            <Text style={tw`flex-1 text-sm text-dark-gray`}>{item.text}</Text>
          </View>
        );
      })}
    </View>
  );
}

export function NoteDetailScreen({ recordingId, onBack }: { recordingId: string; onBack: () => void }) {
  const { load: reloadNotes } = useNotes();
  const { getRole, logMeeting } = useTime();
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'notes' | 'transcript'>('notes');
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState<'tasks' | 'log' | 'enhance' | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const fetchNote = useCallback(async () => {
    setError(null);
    try {
      const next = await api.note(recordingId);
      setNote(next);
      return next;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    }
  }, [recordingId]);

  useEffect(() => {
    setNote(null);
    void fetchNote().then((n) => setSelected(n?.actionItems.filter((a) => !a.taskId).map((a) => a.index) ?? []));
  }, [fetchNote]);

  const run = async (kind: 'tasks' | 'log' | 'enhance', work: () => Promise<string>) => {
    setBusy(kind);
    try {
      setToast(await work());
      await fetchNote();
      void reloadNotes();
    } catch (err) {
      setToast(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (!note) {
    return (
      <View style={tw`flex-1 bg-white`}>
        <NavHeader title="Meeting notes" onBack={onBack} />
        {error ? <ErrorState message={error} onRetry={() => void fetchNote()} /> : <LoadingState />}
      </View>
    );
  }

  const pending = selected.filter((i) => note.actionItems.some((a) => a.index === i && !a.taskId));
  const canCreateTasks = Boolean(note.project) && note.canEdit;
  const speakerKeys = Object.keys(note.speakerNames);
  const speakers = Array.from(new Set(Object.values(note.speakerNames)));
  const logged = note.meeting?.timeEntry ?? null;

  const createTasks = () =>
    run('tasks', async () => {
      const items = note.actionItems.filter((a) => pending.includes(a.index));
      const { created } = await api.createTasks(
        note.id,
        items.map((a) => ({ index: a.index, title: a.text, assigneeId: a.ownerUserId ?? undefined, dueAt: a.due ?? undefined })),
      );
      setSelected([]);
      return `${created.length} task${created.length === 1 ? '' : 's'} created in DALI OS`;
    });

  const logThisMeeting = () =>
    run('log', async () => {
      if (!note.meeting) return '';
      await logMeeting(note.meeting);
      return 'Meeting added to your timesheet';
    });

  const writeNotes = () =>
    run('enhance', async () => {
      await api.enhanceNote(note.id);
      return 'Notes written to the meeting page';
    });

  const openPage = () => {
    if (note.pagePath) void WebBrowser.openBrowserAsync(`${clientConfig().baseUrl}${note.pagePath}`);
  };

  return (
    <View style={tw`flex-1 bg-white`}>
      <NavHeader
        onBack={onBack}
        title={note.title}
        subtitle={`${format(new Date(note.createdAt), 'EEE, MMM d · h:mm a')} · ${formatRecordedLength(note.recordedSeconds)}`}
        trailing={
          note.pagePath ? (
            <Pressable accessibilityRole="link" accessibilityLabel="Open in DALI OS" onPress={openPage} hitSlop={8} style={tw`px-2`}>
              <ExternalLink size={18} color={colors.navy} />
            </Pressable>
          ) : undefined
        }
      />

      <View style={tw`border-b border-slate-200 px-4 py-2.5`}>
        <View accessibilityRole="tablist" style={tw`flex-row gap-1 rounded-xl bg-slate-100 p-1`}>
          {(['notes', 'transcript'] as const).map((v) => (
            <Pressable
              key={v}
              accessibilityRole="tab"
              accessibilityState={{ selected: view === v }}
              onPress={() => setView(v)}
              style={[tw`flex-1 items-center rounded-lg py-1.5`, view === v && tw`bg-white`]}>
              <Text style={[tw`text-sm capitalize`, view === v ? tw`font-bold text-navy` : tw`text-slate-500`]}>{v}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={tw`px-4 pb-10 pt-4`}>
        {view === 'notes' ? (
          <>
            <View style={tw`flex-row flex-wrap items-center gap-2`}>
              {speakers.length > 0 ? (
                <View accessibilityLabel={`${speakers.length} speakers`} style={tw`flex-row`}>
                  {speakers.map((name, i) => (
                    <View key={name} style={i > 0 && { marginLeft: -6 }}>
                      <Avatar name={name} size="xs" ring />
                    </View>
                  ))}
                </View>
              ) : null}
              {note.project ? (
                <Tag size="sm" tone="green">
                  {note.project.name}
                </Tag>
              ) : null}
            </View>

            {note.status !== 'Done' ? (
              <View style={tw`mt-4 rounded-xl bg-cool-white p-3`}>
                <Text style={[tw`text-sm`, note.status === 'Failed' ? tw`text-dark-coral` : tw`text-dark-gray`]}>
                  {note.status === 'Failed' ? note.error ?? 'Transcription failed.' : STATUS_MESSAGE[note.status]}
                </Text>
              </View>
            ) : null}

            {note.status === 'Done' && !note.enhancedAt && note.canEdit ? (
              <View style={tw`mt-4 flex-row items-center gap-3 rounded-xl border border-slate-200 p-3`}>
                <Sparkles size={18} color={colors.teal} />
                <Text style={tw`flex-1 text-sm text-dark-gray`}>Turn the transcript into notes on the meeting page.</Text>
                <Button size="sm" loading={busy === 'enhance'} onPress={() => void writeNotes()}>
                  Write notes
                </Button>
              </View>
            ) : null}

            <Outline items={note.outline} />

            {note.actionItems.length > 0 ? (
              <>
                <Eyebrow style={tw`mt-5`}>Action items</Eyebrow>
                <View style={tw`mt-1.5 overflow-hidden rounded-xl border border-slate-200`}>
                  {note.actionItems.map((a, i) => {
                    const isSelected = selected.includes(a.index);
                    const meta = (
                      <View style={tw`mt-1 flex-row items-center gap-1.5`}>
                        {a.ownerName ? <Avatar name={a.ownerName} size="xs" /> : null}
                        <Text style={tw`text-xs text-slate-500`}>
                          {a.ownerName ?? 'Unassigned'}
                          {a.due ? ` · Due ${formatShortDate(a.due)}` : ''}
                        </Text>
                      </View>
                    );
                    const row = [tw`flex-row items-start gap-3 px-3 py-2.5`, i > 0 && tw`border-t border-slate-100`];
                    if (a.taskId || !canCreateTasks) {
                      return (
                        <View key={a.index} style={row}>
                          {a.taskId ? <CheckCircle2 size={20} color={colors.teal} /> : <View style={tw`mt-[7px] h-1.5 w-1.5 rounded-full bg-teal`} />}
                          <View style={tw`flex-1`}>
                            <Text style={tw`text-sm font-bold text-cool-black`}>{a.text}</Text>
                            {meta}
                          </View>
                          {a.taskId ? (
                            <Tag size="sm" tone="green">
                              Task created
                            </Tag>
                          ) : null}
                        </View>
                      );
                    }
                    return (
                      <Pressable
                        key={a.index}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: isSelected }}
                        onPress={() => setSelected((s) => (s.includes(a.index) ? s.filter((x) => x !== a.index) : [...s, a.index]))}
                        style={({ pressed }) => [...row, pressed && tw`bg-slate-50`]}>
                        <View style={[tw`mt-0.5 h-5 w-5 items-center justify-center rounded-md border-2`, isSelected ? tw`border-teal bg-teal` : tw`border-slate-300`]}>
                          {isSelected ? <Check size={12} color={colors.white} strokeWidth={3} /> : null}
                        </View>
                        <View style={tw`flex-1`}>
                          <Text style={tw`text-sm font-bold text-cool-black`}>{a.text}</Text>
                          {meta}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                {canCreateTasks && note.actionItems.some((a) => !a.taskId) ? (
                  <Button
                    fullWidth
                    variant="secondary"
                    color="navy"
                    style={tw`mt-3`}
                    disabled={pending.length === 0}
                    loading={busy === 'tasks'}
                    onPress={() => void createTasks()}>
                    {pending.length === 0 ? 'Select action items to create tasks' : `Create ${pending.length} task${pending.length === 1 ? '' : 's'} in DALI OS`}
                  </Button>
                ) : null}
              </>
            ) : null}

            {note.meeting ? (
              <View style={tw`mt-6 flex-row items-center gap-3 rounded-xl border border-slate-200 p-3`}>
                <View style={tw`h-9 w-9 items-center justify-center rounded-lg bg-pale-blue`}>
                  <Timer size={16} color={colors.navy} />
                </View>
                <View style={tw`flex-1`}>
                  <Text style={tw`text-sm font-bold text-cool-black`}>{logged ? 'On your timesheet' : 'Log this meeting'}</Text>
                  <Text style={tw`text-xs text-slate-500`}>
                    {logged
                      ? [formatHours(logged.hours), getRole(logged.roleRefId)?.label].filter(Boolean).join(' · ')
                      : `${formatHours(hoursBetween(new Date(note.meeting.start), new Date(note.meeting.end)))} from the calendar`}
                  </Text>
                </View>
                {logged ? (
                  <CheckCircle2 size={20} color={colors.teal} accessibilityLabel="Logged" />
                ) : (
                  <Button size="sm" loading={busy === 'log'} onPress={() => void logThisMeeting()}>
                    Add
                  </Button>
                )}
              </View>
            ) : null}

            <View style={tw`mt-5 flex-row items-center gap-1.5`}>
              <RefreshCw size={12} color={colors.slate500} />
              <Text style={tw`text-xs text-slate-500`}>Saved to this meeting’s notes page in DALI OS</Text>
            </View>
          </>
        ) : note.lines.length === 0 ? (
          <Text style={tw`py-10 text-center text-sm text-slate-500`}>No transcript was captured.</Text>
        ) : (
          <View style={tw`gap-4`}>
            {note.lines.map((l) => {
              const colorIndex = Math.max(0, speakerKeys.indexOf(l.speaker ?? ''));
              return (
                <View key={`${l.at}-${l.speaker}`}>
                  <Text style={[tw`text-xs font-bold`, { color: SPEAKER_COLORS[colorIndex % SPEAKER_COLORS.length] }]}>
                    {(l.speaker && note.speakerNames[l.speaker]) || 'Speaker'} <Text style={tw`font-body text-slate-400`}>{formatTimestamp(l.at)}</Text>
                  </Text>
                  <Text style={tw`mt-0.5 text-[15px] leading-snug text-dark-gray`}>{l.text}</Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </View>
  );
}
