import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Switch, View } from 'react-native';
import { format } from 'date-fns';
import { Calendar, Clock, MapPin, Mic, NotebookPen, NotebookText, Timer, Video, type LucideIcon } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import { errorMessage } from '../../api/client';
import { useNotes, type MeetingTarget } from '../../contexts/NotesContext';
import { useTime } from '../../contexts/TimeContext';
import { useMembers } from '../../contexts/useMembers';
import type { CalendarEvent, Rsvp } from '../../types/calendar';
import { CATEGORY_META } from '../../utils/eventCategory';
import { formatHours, hoursBetween, toDateKey } from '../../utils/hours';
import { meetingTarget } from '../../utils/meeting';
import { formatTimeRange, toMs } from '../../utils/time';
import { Avatar } from '../ui/Avatar';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Eyebrow } from '../ui/Eyebrow';
import { Text } from '../ui/Text';

const RSVP_OPTIONS: { value: Rsvp; label: string }[] = [
  { value: 'accepted', label: 'Going' },
  { value: 'tentative', label: 'Maybe' },
  { value: 'declined', label: 'No' },
];

interface EventDetailSheetProps {
  event?: CalendarEvent;
  onClose: () => void;
  onRsvp: (event: CalendarEvent, rsvp: Rsvp) => void;
  onRecord: (meeting: MeetingTarget) => Promise<string | null>;
  onViewNote: (recordingId: string) => void;
}

function Detail({ icon: I, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <View style={tw`flex-row items-center gap-2.5`}>
      <I size={16} color={colors.slate400} />
      <Text style={tw`flex-1 text-sm text-dark-gray`}>{children}</Text>
    </View>
  );
}

export function EventDetailSheet({ event, onClose, onRsvp, onRecord, onViewNote }: EventDetailSheetProps) {
  const { getMember, meId } = useMembers();
  const { active, noteForMeeting } = useNotes();
  const { roles, getRole, meetingEntry, ensurePeriodFor, logMeeting, deleteEntry } = useTime();
  const [busy, setBusy] = useState<'record' | 'log' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef<CalendarEvent | undefined>(event);
  if (event) last.current = event;
  const shown = event ?? last.current;
  const hasAttendees = Boolean(shown && shown.attendeeIds.length > 0);

  const meeting = shown && !shown.isAllDay ? meetingTarget(shown) : null;
  const note = meeting ? noteForMeeting(meeting.id, meeting.occurrenceStart) : undefined;
  const recordingThis = Boolean(meeting && active?.meeting?.id === meeting.id && active.meeting.occurrenceStart === meeting.occurrenceStart);
  const logged = meeting ? meetingEntry(meeting.id, meeting.occurrenceStart) : undefined;
  const started = Boolean(shown && toMs(shown.start) <= Date.now());

  useEffect(() => {
    setError(null);
    if (event && meetingTarget(event)) ensurePeriodFor(toDateKey(new Date(event.start)));
  }, [event, ensurePeriodFor]);

  const record = async () => {
    if (!meeting) return;
    setBusy('record');
    const message = await onRecord(meeting);
    setBusy(null);
    if (message) setError(message);
    else onClose();
  };

  const toggleTimesheet = async () => {
    if (!meeting) return;
    setBusy('log');
    setError(null);
    try {
      if (logged) await deleteEntry(logged.id);
      else await logMeeting(meeting);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <BottomSheet open={Boolean(event)} onClose={onClose} title="Meeting">
      {shown ? (
        <>
          <View style={tw`flex-row items-center gap-2`}>
            <View style={[tw`h-2.5 w-2.5 rounded-full`, tw.style(CATEGORY_META[shown.category].bar)]} />
            <Eyebrow>{CATEGORY_META[shown.category].label}</Eyebrow>
          </View>
          <Text style={tw`mt-1.5 font-heading text-xl leading-snug text-cool-black`}>{shown.title}</Text>

          <View style={tw`mt-4 gap-2.5`}>
            <Detail icon={Calendar}>{format(new Date(shown.start), 'EEEE, MMMM d')}</Detail>
            {!shown.isAllDay ? <Detail icon={Clock}>{formatTimeRange(shown.start, shown.end)}</Detail> : null}
            {shown.location ? <Detail icon={MapPin}>{shown.location}</Detail> : null}
          </View>

          {shown.meetingUrl ? (
            <Button fullWidth size="sm" leftIcon={Video} style={tw`mt-4`} onPress={() => void Linking.openURL(shown.meetingUrl as string)}>
              Join meeting
            </Button>
          ) : null}

          {shown.description ? (
            <View style={tw`mt-4 rounded-xl bg-cool-white p-3`}>
              <Text style={tw`text-sm text-dark-gray`}>{shown.description}</Text>
            </View>
          ) : null}

          {meeting ? (
            <View style={tw`mt-4 gap-2`}>
              {note ? (
                <Button fullWidth variant="secondary" color="navy" leftIcon={NotebookText} onPress={() => onViewNote(note.id)}>
                  View meeting notes
                </Button>
              ) : (
                <Button
                  fullWidth
                  color="coral"
                  leftIcon={Mic}
                  loading={busy === 'record'}
                  disabled={Boolean(active) && !recordingThis}
                  onPress={() => void record()}>
                  {recordingThis ? 'Return to the recorder' : active ? 'Another recording is in progress' : 'Record meeting notes'}
                </Button>
              )}

              <View style={tw`flex-row items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5`}>
                <Timer size={18} color={colors.navy} />
                <View style={tw`flex-1`}>
                  <Text style={tw`text-sm font-bold text-cool-black`}>Add to timesheet</Text>
                  <Text style={tw`text-xs text-slate-500`}>
                    {logged
                      ? [formatHours(logged.hours), getRole(logged.roleRefId)?.label].filter(Boolean).join(' · ')
                      : roles.length === 0
                        ? 'You have no role to log hours to this term'
                        : started
                          ? `${formatHours(hoursBetween(new Date(shown.start), new Date(shown.end)))} · ${roles[0].label}`
                          : 'Available once the meeting starts'}
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Add to timesheet"
                  value={Boolean(logged)}
                  disabled={busy === 'log' || (!logged && (!started || roles.length === 0))}
                  onValueChange={() => void toggleTimesheet()}
                  trackColor={{ true: colors.teal, false: colors.slate300 }}
                  thumbColor={colors.white}
                  ios_backgroundColor={colors.slate300}
                />
              </View>
              {error ? (
                <Text accessibilityLiveRegion="polite" style={tw`text-xs text-dark-coral`}>
                  {error}
                </Text>
              ) : null}
            </View>
          ) : null}

          {shown.rsvpNotificationId ? (
            <View style={tw`mt-5`}>
              <Eyebrow>Going?</Eyebrow>
              <View accessibilityRole="radiogroup" style={tw`mt-2 flex-row gap-2`}>
                {RSVP_OPTIONS.map((opt) => {
                  const selected = shown.rsvp === opt.value;
                  const tone = opt.value === 'declined' ? tw`border-coral bg-coral` : tw`border-teal bg-teal`;
                  return (
                    <Pressable
                      key={opt.value}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      onPress={() => onRsvp(shown, opt.value)}
                      style={({ pressed }) => [
                        tw`flex-1 items-center rounded-xl border py-2`,
                        selected ? tone : [tw`border-slate-200`, pressed && tw`bg-slate-50`],
                      ]}>
                      <Text style={[tw`text-sm font-bold`, selected ? tw`text-white` : tw`text-dark-gray`]}>{opt.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {hasAttendees ? (
            <View style={tw`mt-5`}>
              <Eyebrow>{shown.attendeeIds.length} attendees</Eyebrow>
              <View style={tw`mt-2 gap-2`}>
                {shown.attendeeIds.map((id) => (
                  <View key={id} style={tw`flex-row items-center gap-2.5`}>
                    <Avatar name={getMember(id)?.name ?? '?'} size="xs" />
                    <Text style={tw`text-sm text-cool-black`}>
                      {getMember(id)?.name}
                      {id === meId ? <Text style={tw`text-slate-400`}> (you)</Text> : null}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          <View style={tw`mt-5 flex-row items-start gap-2.5 rounded-xl border border-slate-200 p-3`}>
            <View style={tw`mt-0.5`}>
              <NotebookPen size={14} color={colors.slate500} />
            </View>
            <Text style={tw`flex-1 text-xs text-slate-500`}>
              From <Text style={tw`font-bold text-dark-gray`}>{shown.calendar}</Text>. Notes, RSVPs and timesheet hours sync with DALI OS.
            </Text>
          </View>
        </>
      ) : null}
    </BottomSheet>
  );
}
