import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import { addDays, addMinutes, eachDayOfInterval, format, set, subHours } from 'date-fns';
import { Calendar, Minus, Plus, Trash2 } from 'lucide-react-native';
import { colors, fonts, tw } from '../../theme';
import { errorMessage } from '../../api/client';
import type { TimeEntry } from '../../api/contract';
import { useTime } from '../../contexts/TimeContext';
import { formatHours, fromDateKey, hoursBetween, MAX_NOTE_LENGTH, toDateKey, validateRange } from '../../utils/hours';
import { roleColor } from '../../utils/roleColor';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Text } from '../ui/Text';

const STEP_MINUTES = 15;

interface EntrySheetProps {
  open: boolean;
  /** Entry to edit; null adds a new one. */
  entry: TimeEntry | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

function TimeStepper({ label, value, onChange, disabled }: { label: string; value: Date; onChange: (d: Date) => void; disabled?: boolean }) {
  return (
    <View style={tw`flex-1`}>
      <Text style={tw`text-sm font-bold text-cool-black`}>{label}</Text>
      <View style={[tw`mt-1.5 h-11 flex-row items-center justify-between rounded-xl border border-slate-200 bg-white px-1`, disabled && tw`opacity-50`]}>
        <IconButton label={`${label} ${STEP_MINUTES} minutes earlier`} size="sm" disabled={disabled} onPress={() => onChange(addMinutes(value, -STEP_MINUTES))}>
          <Minus size={16} color={colors.navy} />
        </IconButton>
        <Text accessibilityLabel={`${label} ${format(value, 'h:mm a')}`} style={[tw`text-sm font-bold text-cool-black`, { fontVariant: ['tabular-nums'] }]}>
          {format(value, 'h:mm a')}
        </Text>
        <IconButton label={`${label} ${STEP_MINUTES} minutes later`} size="sm" disabled={disabled} onPress={() => onChange(addMinutes(value, STEP_MINUTES))}>
          <Plus size={16} color={colors.navy} />
        </IconButton>
      </View>
    </View>
  );
}

const onDay = (day: string, time: Date) => {
  const d = fromDateKey(day);
  return set(time, { year: d.getFullYear(), month: d.getMonth(), date: d.getDate() });
};

export function EntrySheet({ open, entry, onClose, onSaved }: EntrySheetProps) {
  const { data, roles, addEntry, updateEntry, deleteEntry } = useTime();
  const [roleId, setRoleId] = useState<string | null>(null);
  const [day, setDay] = useState('');
  const [start, setStart] = useState(() => new Date());
  const [end, setEnd] = useState(() => new Date());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const isMeeting = entry?.source === 'Meeting';
  const roleIds = roles.map((r) => r.roleRefId);

  useEffect(() => {
    if (!open) return;
    if (entry) {
      setRoleId(entry.roleRefId ?? roleIds[0] ?? null);
      setDay(entry.day);
      setStart(entry.startTime ? new Date(entry.startTime) : set(fromDateKey(entry.day), { hours: 9, minutes: 0 }));
      setEnd(entry.endTime ? new Date(entry.endTime) : addMinutes(set(fromDateKey(entry.day), { hours: 9, minutes: 0 }), entry.hours * 60));
      setNote(entry.note ?? '');
    } else {
      const now = set(new Date(), { seconds: 0, milliseconds: 0 });
      const rounded = set(now, { minutes: Math.floor(now.getMinutes() / STEP_MINUTES) * STEP_MINUTES });
      setRoleId(roleIds[0] ?? null);
      setDay(toDateKey(now));
      setStart(subHours(rounded, 1));
      setEnd(rounded);
      setNote('');
    }
    setError(undefined);
    // Re-seed only when the sheet opens on an entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry]);

  const startAt = onDay(day || toDateKey(start), start);
  // An end before the start on the same day reads as past midnight.
  let endAt = onDay(day || toDateKey(start), end);
  if (endAt <= startAt) endAt = addDays(endAt, 1);
  const rangeError = validateRange(startAt, endAt);

  const today = data?.today ?? toDateKey(new Date());
  const days = data
    ? eachDayOfInterval({ start: fromDateKey(data.period.start), end: fromDateKey(data.period.end < today ? data.period.end : today) }).map(toDateKey).reverse()
    : [];

  const save = async () => {
    if (!roleId) return setError('Pick a role.');
    if (rangeError) return setError(rangeError);
    setSaving(true);
    try {
      const input = { roleRefId: roleId, start: startAt, end: endAt, note };
      if (entry) {
        await updateEntry(entry, input);
        onSaved('Entry updated');
      } else {
        await addEntry(input);
        onSaved(`Added ${formatHours(hoursBetween(startAt, endAt))} to your timesheet`);
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!entry) return;
    Alert.alert(isMeeting ? 'Take this meeting off your timesheet?' : 'Delete this entry from your timesheet?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: isMeeting ? 'Remove' : 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteEntry(entry.id);
            onSaved(isMeeting ? 'Meeting removed from your timesheet' : 'Entry deleted');
            onClose();
          } catch (err) {
            setError(errorMessage(err));
          }
        },
      },
    ]);
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={entry ? 'Edit time entry' : 'Add time'}
      description="Saves straight to your DALI OS timesheet"
      footer={
        <View style={tw`flex-row gap-2`}>
          {entry ? (
            <Button variant="ghost" color="coral" leftIcon={Trash2} onPress={remove}>
              {isMeeting ? 'Remove' : 'Delete'}
            </Button>
          ) : null}
          <View style={tw`flex-1`}>
            <Button fullWidth loading={saving} onPress={() => void save()}>
              {entry ? 'Save' : 'Add to timesheet'}
            </Button>
          </View>
        </View>
      }>
      {isMeeting ? (
        <View style={tw`mb-4 flex-row items-center gap-2 rounded-xl bg-cool-white px-3 py-2.5`}>
          <Calendar size={15} color={colors.navy} />
          <Text style={tw`flex-1 text-sm text-dark-gray`}>
            Logged from <Text style={tw`font-bold`}>{entry?.meetingTitle ?? 'a meeting'}</Text>. Its hours follow the meeting.
          </Text>
        </View>
      ) : null}

      <Text style={tw`text-sm font-bold text-cool-black`}>Role</Text>
      <View accessibilityRole="radiogroup" style={tw`mt-2 gap-2`}>
        {roles.map((r) => {
          const selected = r.roleRefId === roleId;
          return (
            <Pressable
              key={r.roleRefId}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => setRoleId(r.roleRefId)}
              style={[tw`flex-row items-center gap-3 rounded-xl border px-3 py-2.5`, selected ? tw`border-teal bg-[#E6F7F7]` : tw`border-slate-200`]}>
              <View style={[tw`h-2.5 w-2.5 rounded-full`, { backgroundColor: roleColor(roleIds, r.roleRefId) }]} />
              <View style={tw`flex-1`}>
                <Text style={tw`text-sm font-bold text-cool-black`}>{r.label}</Text>
                <Text style={tw`text-xs text-slate-500`}>{r.detail}</Text>
              </View>
              <View style={[tw`h-4 w-4 rounded-full`, selected ? tw`border-[5px] border-teal` : tw`border-2 border-slate-300`]} />
            </Pressable>
          );
        })}
      </View>

      {!isMeeting ? (
        <>
          <Text style={tw`mt-4 text-sm font-bold text-cool-black`}>Date</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={tw`-mx-5 mt-2`} contentContainerStyle={tw`gap-2 px-5`}>
            {days.map((d) => {
              const selected = d === day;
              return (
                <Pressable
                  key={d}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={format(fromDateKey(d), 'EEEE, MMMM d')}
                  onPress={() => setDay(d)}
                  style={[tw`w-12 items-center rounded-xl border py-2`, selected ? tw`border-teal bg-teal` : tw`border-slate-200 bg-white`]}>
                  <Text style={[tw`text-[11px]`, selected ? tw`text-white` : tw`text-slate-500`]}>{format(fromDateKey(d), 'EEE')}</Text>
                  <Text style={[tw`text-base font-bold`, selected ? tw`text-white` : tw`text-cool-black`]}>{format(fromDateKey(d), 'd')}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      ) : null}

      <View style={tw`mt-4 flex-row gap-3`}>
        <TimeStepper label="Start" value={start} onChange={setStart} disabled={isMeeting} />
        <TimeStepper label="End" value={end} onChange={setEnd} disabled={isMeeting} />
      </View>
      <Text accessibilityLiveRegion="polite" style={[tw`mt-2 text-xs`, error ? tw`text-dark-coral` : tw`text-slate-500`]}>
        {error ?? rangeError ?? `Duration ${formatHours(hoursBetween(startAt, endAt))}`}
      </Text>

      <Text style={tw`mt-4 text-sm font-bold text-cool-black`}>Note</Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        maxLength={MAX_NOTE_LENGTH}
        multiline
        placeholder="What did you work on?"
        placeholderTextColor={colors.slate400}
        accessibilityLabel="Note"
        style={[tw`mt-1.5 min-h-20 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-cool-black`, { fontFamily: fonts.body, textAlignVertical: 'top' }]}
      />
      <Text style={tw`mt-1 text-right text-[11px] text-slate-400`}>
        {note.length}/{MAX_NOTE_LENGTH}
      </Text>
    </BottomSheet>
  );
}
