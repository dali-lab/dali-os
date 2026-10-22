import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { isSameDay, startOfWeek } from 'date-fns';
import { AlertCircle, Clock, ListChecks, MapPin, Mic, RefreshCw, Zap } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import { useData, weekKey } from '../../contexts/DataContext';
import { elapsedSeconds, useNotes } from '../../contexts/NotesContext';
import { useNow } from '../../hooks/useNow';
import { formatElapsed, formatRecordedLength } from '../../utils/hours';
import { meetingTarget } from '../../utils/meeting';
import { formatCountdown, formatDayLabel, formatTimeRange, toMs } from '../../utils/time';
import { TopBar } from '../TopBar';
import { Button } from '../ui/Button';
import { Eyebrow } from '../ui/Eyebrow';
import { ErrorState, LoadingState } from '../ui/StateViews';
import { Text } from '../ui/Text';

const STATUS_LABEL: Record<string, string> = {
  Pending: 'Starting',
  Recording: 'Recording',
  Stopped: 'Paused',
  Processing: 'Processing',
  Failed: 'Couldn’t process',
};

export function NotesHome({ onOpenProfile, onError }: { onOpenProfile: () => void; onError: (message: string) => void }) {
  const { notes, error, load, active, recorderVisible, startRecording, showRecorder, openNote } = useNotes();
  const { weeks } = useData();
  const now = useNow(1000, active?.phase === 'recording');
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState<'meeting' | 'quick' | null>(null);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const suggestion = (weeks[weekKey(startOfWeek(now))]?.data ?? [])
    .filter((e) => !e.isAllDay && e.attendeeIds.length > 0 && meetingTarget(e) && isSameDay(new Date(e.start), now) && toMs(e.end) > now.getTime())
    .sort((a, b) => toMs(a.start) - toMs(b.start))[0];

  const record = async (kind: 'meeting' | 'quick') => {
    setStarting(kind);
    const message = await startRecording(kind === 'meeting' && suggestion ? meetingTarget(suggestion) : null);
    setStarting(null);
    if (message) onError(message);
  };

  const recordingEnabled = notes?.recordingEnabled ?? false;
  const list = (notes?.notes ?? []).filter((n) => n.id !== active?.id);

  return (
    <View style={tw`flex-1 bg-cool-white`}>
      <TopBar title="Notes" onOpenProfile={onOpenProfile} />
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
                <View style={tw`rounded-2xl border border-slate-200 bg-white p-4`}>
                  {suggestion ? (
                    <>
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
                      <View style={tw`mt-4 flex-row gap-2`}>
                        <View style={tw`flex-1`}>
                          <Button fullWidth color="coral" leftIcon={Mic} loading={starting === 'meeting'} disabled={starting !== null} onPress={() => void record('meeting')}>
                            Record notes
                          </Button>
                        </View>
                        <Button variant="secondary" color="navy" leftIcon={Zap} loading={starting === 'quick'} disabled={starting !== null} onPress={() => void record('quick')}>
                          Quick
                        </Button>
                      </View>
                    </>
                  ) : (
                    <>
                      <Text style={tw`font-heading text-lg text-cool-black`}>No more meetings today</Text>
                      <Text style={tw`mt-1 text-sm text-slate-500`}>Start a quick recording for anything else.</Text>
                      <Button fullWidth color="coral" leftIcon={Mic} loading={starting === 'quick'} style={tw`mt-4`} onPress={() => void record('quick')}>
                        Quick record
                      </Button>
                    </>
                  )}
                </View>
              )}
            </View>

            <View style={tw`px-4 pt-6`}>
              <Eyebrow>Recent notes</Eyebrow>
              {list.length === 0 ? (
                <View style={[tw`mt-2 rounded-xl border border-medium-gray bg-white px-4 py-6`, { borderStyle: 'dashed' }]}>
                  <Text style={tw`text-center text-sm text-slate-500`}>Your meeting notes will show up here.</Text>
                </View>
              ) : (
                <View style={tw`mt-2 gap-2`}>
                  {list.map((n) => (
                    <Pressable
                      key={n.id}
                      accessibilityRole="button"
                      onPress={() => openNote(n.id)}
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
                  ))}
                </View>
              )}
            </View>

            <View style={tw`mt-5 flex-row items-center justify-center gap-1.5 px-6`}>
              <RefreshCw size={12} color={colors.slate500} />
              <Text style={tw`text-center text-xs text-slate-500`}>Notes save to each meeting’s page in DALI OS</Text>
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
