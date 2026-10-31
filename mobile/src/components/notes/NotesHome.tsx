import React, { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { isSameDay, startOfWeek } from 'date-fns';
import { AlertCircle, BookOpen, Clock, ListChecks, MapPin, Mic, PenLine, Plus, RefreshCw } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import type { NoteSummary } from '../../api/contract';
import { useData, weekKey } from '../../contexts/DataContext';
import { elapsedSeconds, useNotes } from '../../contexts/NotesContext';
import { useNow } from '../../hooks/useNow';
import { formatElapsed, formatRecordedLength } from '../../utils/hours';
import { meetingTarget } from '../../utils/meeting';
import { createNotePage, type NoteDestination } from '../../utils/notePages';
import { formatCountdown, formatDayLabel, formatTimeRange, toMs } from '../../utils/time';
import { TopBar } from '../TopBar';
import { IconButton } from '../ui/IconButton';
import { Button } from '../ui/Button';
import { Eyebrow } from '../ui/Eyebrow';
import { ErrorState, LoadingState } from '../ui/StateViews';
import { Text } from '../ui/Text';
import { NoteDestinationSheet } from './NoteDestinationSheet';

const STATUS_LABEL: Record<string, string> = {
  Pending: 'Starting',
  Recording: 'Recording',
  Stopped: 'Paused',
  Processing: 'Processing',
  Failed: 'Couldn’t process',
};

function RecordingRow({ note: n, onOpen }: { note: NoteSummary; onOpen: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [tw`rounded-2xl border bg-white p-4`, pressed ? tw`border-medium-gray` : tw`border-slate-200`]}>
      <View style={tw`flex-row items-start justify-between gap-3`}>
        <Text style={tw`flex-1 font-bold text-cool-black`}>{n.title}</Text>
        <Text style={tw`text-xs text-slate-400`}>{formatDayLabel(n.createdAt)}</Text>
      </View>
      <View style={tw`mt-3 flex-row flex-wrap items-center gap-x-3 gap-y-1`}>
        <View style={tw`flex-row items-center gap-1`}>
          <Clock size={12} color={colors.slate500} />
          <Text style={tw`text-xs text-slate-500`}>{formatRecordedLength(n.recordedSeconds)}</Text>
        </View>
        {n.status === 'Done' ? (
          <View style={tw`flex-row items-center gap-1`}>
            <ListChecks size={12} color={colors.slate500} />
            <Text style={tw`text-xs text-slate-500`}>
              {n.actionItemCount} action item{n.actionItemCount === 1 ? '' : 's'}
            </Text>
          </View>
        ) : (
          <View style={tw`flex-row items-center gap-1`}>
            <AlertCircle size={12} color={n.status === 'Failed' ? colors.darkCoral : colors.slate500} />
            <Text style={[tw`text-xs`, n.status === 'Failed' ? tw`text-dark-coral` : tw`text-slate-500`]}>{STATUS_LABEL[n.status] ?? n.status}</Text>
          </View>
        )}
        {n.tasksCreated > 0 ? <Text style={tw`text-xs font-bold text-teal`}>{n.tasksCreated} in DALI OS</Text> : null}
      </View>
    </Pressable>
  );
}

export function NotesHome({ onOpenProfile, onError }: { onOpenProfile: () => void; onError: (message: string) => void }) {
  const { notes, error, load, loadingMore, loadMore, active, recorderVisible, startRecording, showRecorder, openNote, openEditor } = useNotes();
  const { weeks } = useData();
  const now = useNow(1000, active?.phase === 'recording');
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState<'meeting' | 'elsewhere' | 'note' | null>(null);
  const [picking, setPicking] = useState<'note' | 'record' | null>(null);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const suggestion = (weeks[weekKey(startOfWeek(now))]?.data ?? [])
    .filter((e) => !e.isAllDay && e.attendeeIds.length > 0 && meetingTarget(e) && isSameDay(new Date(e.start), now) && toMs(e.end) > now.getTime())
    .sort((a, b) => toMs(a.start) - toMs(b.start))[0];

  const recordMeeting = async () => {
    const meeting = suggestion ? meetingTarget(suggestion) : null;
    if (!meeting) return;
    setStarting('meeting');
    const message = await startRecording({ kind: 'meeting', meeting });
    setStarting(null);
    if (message) onError(message);
  };

  // New note and Record without a meeting both start by asking where the note is filed.
  const onPicked = async (destination: NoteDestination) => {
    const mode = picking;
    setPicking(null);
    setStarting(mode === 'note' ? 'note' : 'elsewhere');
    try {
      const page = await createNotePage(destination);
      if (mode === 'note') openEditor({ pageId: page.pageId, title: page.title });
      else {
        const message = await startRecording({ kind: 'page', title: page.title, documentName: page.documentName });
        if (message) onError(message);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Couldn’t create the note.');
    } finally {
      setStarting(null);
    }
  };

  const recordingEnabled = notes?.recordingEnabled ?? false;
  const recordings = (notes?.notes ?? []).filter((n) => n.id !== active?.id);
  const recent = [
    ...recordings.map((n) => ({ kind: 'recording' as const, at: n.createdAt, note: n })),
    ...(notes?.pages ?? []).map((p) => ({ kind: 'typed' as const, at: p.updatedAt, page: p })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <View style={tw`flex-1 bg-cool-white`}>
      <TopBar
        title="Notes"
        onOpenProfile={onOpenProfile}
        actions={
          <IconButton label="New note" disabled={starting !== null} onPress={() => setPicking('note')}>
            <Plus size={20} color={colors.navy} />
          </IconButton>
        }
      />
      <ScrollView
        contentContainerStyle={tw`pb-8`}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.teal} colors={[colors.teal]} />}>
        {!notes && error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
        {!notes && !error ? <LoadingState /> : null}
        {notes ? (
          <>
            <View style={tw`px-4 pt-4`}>
              {active && !recorderVisible ? (
                <Pressable accessibilityRole="button" onPress={showRecorder} style={tw`flex-row items-center gap-3 rounded-2xl bg-dark-navy p-4`}>
                  <View style={tw`h-10 w-10 items-center justify-center rounded-full bg-coral`}>
                    <Mic size={18} color={colors.white} />
                  </View>
                  <View style={tw`flex-1`}>
                    <Text style={tw`font-eyebrow text-[10px] uppercase tracking-widest text-pale-coral`}>
                      {active.phase === 'recording' ? 'Recording' : active.phase === 'paused' ? 'Paused' : active.phase === 'failed' ? 'Couldn’t process' : 'Processing'}
                    </Text>
                    <Text numberOfLines={1} style={tw`text-sm font-bold text-white`}>
                      {active.title}
                    </Text>
                  </View>
                  <Text style={[tw`font-heading text-lg text-white`, { fontVariant: ['tabular-nums'] }]}>{formatElapsed(elapsedSeconds(active, now.getTime()))}</Text>
                </Pressable>
              ) : !recordingEnabled ? (
                <View style={tw`rounded-2xl border border-slate-200 bg-white p-4`}>
                  <Text style={tw`font-heading text-lg text-cool-black`}>Recording isn’t on for you yet</Text>
                  <Text style={tw`mt-1 text-sm text-slate-500`}>Your meeting notes still show up here.</Text>
                </View>
              ) : (
                <View style={tw`gap-3`}>
                  {suggestion ? (
                    <View style={tw`rounded-2xl border border-slate-200 bg-white p-4`}>
                      <Text style={tw`font-eyebrow text-[11px] uppercase tracking-widest text-teal`}>{formatCountdown(suggestion.start)}</Text>
                      <Text style={tw`mt-1 font-heading text-lg leading-snug text-cool-black`}>{suggestion.title}</Text>
                      <View style={tw`mt-1 gap-0.5`}>
                        <View style={tw`flex-row items-center gap-1.5`}>
                          <Clock size={13} color={colors.slate500} />
                          <Text style={tw`text-sm text-slate-500`}>{formatTimeRange(suggestion.start, suggestion.end)}</Text>
                        </View>
                        {suggestion.location ? (
                          <View style={tw`flex-row items-center gap-1.5`}>
                            <MapPin size={13} color={colors.slate500} />
                            <Text style={tw`text-sm text-slate-500`}>{suggestion.location}</Text>
                          </View>
                        ) : null}
                      </View>
                      <Button fullWidth color="coral" leftIcon={Mic} loading={starting === 'meeting'} disabled={starting !== null} style={tw`mt-4`} onPress={() => void recordMeeting()}>
                        Record this meeting
                      </Button>
                    </View>
                  ) : (
                    <Text style={tw`px-1 text-sm text-slate-500`}>No more meetings today.</Text>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityHint="Choose where the notes are filed, then start recording"
                    disabled={starting !== null}
                    onPress={() => setPicking('record')}
                    style={({ pressed }) => [tw`flex-row items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4`, pressed && tw`bg-slate-50`, starting !== null && tw`opacity-50`]}>
                    <View style={tw`h-10 w-10 items-center justify-center rounded-full bg-pale-coral/40`}>
                      {starting === 'elsewhere' ? <ActivityIndicator size="small" color={colors.coral} /> : <Mic size={18} color={colors.darkCoral} />}
                    </View>
                    <View style={tw`flex-1`}>
                      <Text style={tw`text-sm font-bold text-cool-black`}>Record without a meeting</Text>
                      <Text style={tw`text-xs text-slate-500`}>File the notes in My notes or a notebook</Text>
                    </View>
                  </Pressable>
                </View>
              )}
            </View>

            <View style={tw`px-4 pt-6`}>
              <Eyebrow>Recent notes</Eyebrow>
              {recent.length === 0 ? (
                <View style={[tw`mt-2 rounded-xl border border-medium-gray bg-white px-4 py-6`, { borderStyle: 'dashed' }]}>
                  <Text style={tw`text-center text-sm text-slate-500`}>Your meeting notes will show up here.</Text>
                </View>
              ) : (
                <View style={tw`mt-2 gap-2`}>
                  {recent.map((item) =>
                    item.kind === 'typed' ? (
                      <Pressable
                        key={`page-${item.page.id}`}
                        accessibilityRole="button"
                        accessibilityHint="Opens the note to edit"
                        onPress={() => openEditor({ pageId: item.page.id, title: item.page.title })}
                        style={({ pressed }) => [tw`rounded-2xl border bg-white p-4`, pressed ? tw`border-medium-gray` : tw`border-slate-200`]}>
                        <View style={tw`flex-row items-start justify-between gap-3`}>
                          <Text style={tw`flex-1 font-bold text-cool-black`}>{item.page.title}</Text>
                          <Text style={tw`text-xs text-slate-400`}>{formatDayLabel(item.page.updatedAt)}</Text>
                        </View>
                        <View style={tw`mt-3 flex-row items-center gap-1`}>
                          {item.page.notebook ? <BookOpen size={12} color={colors.slate500} /> : <PenLine size={12} color={colors.slate500} />}
                          <Text numberOfLines={1} style={tw`flex-1 text-xs text-slate-500`}>
                            {item.page.notebook ?? 'My notes'}
                          </Text>
                        </View>
                      </Pressable>
                    ) : (
                      <RecordingRow key={item.note.id} note={item.note} onOpen={() => openNote(item.note.id)} />
                    ),
                  )}
                </View>
              )}
              {notes.nextCursor ? (
                <Button fullWidth variant="secondary" loading={loadingMore} disabled={loadingMore} style={tw`mt-3`} onPress={() => void loadMore().then((message) => message && onError(message))}>
                  Load more
                </Button>
              ) : null}
            </View>

            <View style={tw`mt-5 flex-row items-center justify-center gap-1.5 px-6`}>
              <RefreshCw size={12} color={colors.slate500} />
              <Text style={tw`text-center text-xs text-slate-500`}>Notes save to each meeting’s page in DALI OS</Text>
            </View>
          </>
        ) : null}
      </ScrollView>
      <NoteDestinationSheet
        open={picking !== null}
        title={picking === 'record' ? 'Record without a meeting' : 'New note'}
        onClose={() => setPicking(null)}
        onPick={(d) => void onPicked(d)}
      />
    </View>
  );
}
