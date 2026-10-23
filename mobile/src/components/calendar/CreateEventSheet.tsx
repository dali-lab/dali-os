import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { addDays, addMinutes, format, set, startOfDay } from 'date-fns';
import { Search, X } from 'lucide-react-native';
import { colors, fonts, tw } from '../../theme';
import { api, errorMessage } from '../../api/client';
import type { MemberSummary } from '../../api/contract';
import { useMembers } from '../../contexts/useMembers';
import { formatHours } from '../../utils/hours';
import { Avatar } from '../ui/Avatar';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { STEP_MINUTES, TimeStepper } from '../ui/TimeStepper';
import { Text } from '../ui/Text';

const DURATIONS = [15, 30, 45, 60, 90, 120];
const DAYS_AHEAD = 21;

interface CreateEventSheetProps {
  open: boolean;
  /** The day the calendar is showing; the event starts on it. */
  day: Date;
  onClose: () => void;
  onCreated: (message: string) => void;
}

const inputStyle = [tw`mt-1.5 h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-cool-black`, { fontFamily: fonts.body }];

/** The next quarter hour today, or 9:00 AM on a future day. */
function nextSlot(day: Date): Date {
  const now = new Date();
  const base = startOfDay(day) > now ? set(day, { hours: 9, minutes: 0 }) : now;
  const rounded = set(base, { minutes: 0, seconds: 0, milliseconds: 0 });
  return addMinutes(rounded, Math.ceil(base.getMinutes() / STEP_MINUTES) * STEP_MINUTES);
}

export function CreateEventSheet({ open, day, onClose, onCreated }: CreateEventSheetProps) {
  const { meId } = useMembers();
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(() => nextSlot(day));
  const [duration, setDuration] = useState(60);
  const [location, setLocation] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemberSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [invited, setInvited] = useState<MemberSummary[]>([]);
  const [addToGoogle, setAddToGoogle] = useState(true);
  const [addMeet, setAddMeet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setStart(nextSlot(day));
    setDuration(60);
    setLocation('');
    setQuery('');
    setResults([]);
    setInvited([]);
    setAddToGoogle(true);
    setAddMeet(false);
    setError(null);
  }, [open, day]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .people(q)
        .then((r) => !cancelled && setResults(r.people))
        .catch(() => !cancelled && setResults([]))
        .finally(() => !cancelled && setSearching(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const days = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(startOfDay(new Date()), i));
  const onDay = (d: Date) => setStart((s) => set(s, { year: d.getFullYear(), month: d.getMonth(), date: d.getDate() }));
  const invitedIds = new Set(invited.map((p) => p.id));
  const matches = results.filter((p) => p.id !== meId && !invitedIds.has(p.id));

  const save = async () => {
    if (!title.trim()) return setError('Give the event a title.');
    setSaving(true);
    setError(null);
    try {
      const res = await api.createEvent({
        title: title.trim(),
        startTime: start.toISOString(),
        durationMinutes: duration,
        participantUserIds: invited.map((p) => p.id),
        location: location.trim() || null,
        addToGoogle,
        addMeet: addToGoogle && addMeet,
      });
      onCreated(
        addToGoogle && !res.addedToGoogle
          ? 'Event added to DALI OS. It isn’t on Google Calendar: link a calendar in DALI OS settings.'
          : invited.length > 0
            ? `Event added and ${invited.length} ${invited.length === 1 ? 'person' : 'people'} invited`
            : 'Event added to your calendar',
      );
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="New event"
      description="Adds a DALI OS meeting you organize"
      footer={
        <Button fullWidth loading={saving} onPress={() => void save()}>
          Add event
        </Button>
      }>
      <Text style={tw`text-sm font-bold text-cool-black`}>Title</Text>
      <TextInput value={title} onChangeText={setTitle} maxLength={200} placeholder="What’s it for?" placeholderTextColor={colors.slate400} accessibilityLabel="Title" style={inputStyle} />

      <Text style={tw`mt-4 text-sm font-bold text-cool-black`}>Day</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={tw`-mx-5 mt-2`} contentContainerStyle={tw`gap-2 px-5`}>
        {days.map((d) => {
          const selected = format(d, 'yyyy-MM-dd') === format(start, 'yyyy-MM-dd');
          return (
            <Pressable
              key={d.toISOString()}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={format(d, 'EEEE, MMMM d')}
              onPress={() => onDay(d)}
              style={[tw`w-12 items-center rounded-xl border py-2`, selected ? tw`border-teal bg-teal` : tw`border-slate-200 bg-white`]}>
              <Text style={[tw`text-[11px]`, selected ? tw`text-white` : tw`text-slate-500`]}>{format(d, 'EEE')}</Text>
              <Text style={[tw`text-base font-bold`, selected ? tw`text-white` : tw`text-cool-black`]}>{format(d, 'd')}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={tw`mt-4 flex-row gap-3`}>
        <TimeStepper label="Starts" value={start} onChange={setStart} />
        <View style={tw`flex-1`}>
          <Text style={tw`text-sm font-bold text-cool-black`}>Ends</Text>
          <View style={tw`mt-1.5 h-11 items-center justify-center rounded-xl bg-cool-white`}>
            <Text style={tw`text-sm font-bold text-dark-gray`}>{format(addMinutes(start, duration), 'h:mm a')}</Text>
          </View>
        </View>
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel="Length" style={tw`mt-2 flex-row flex-wrap gap-1.5`}>
        {DURATIONS.map((m) => {
          const selected = m === duration;
          return (
            <Pressable
              key={m}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => setDuration(m)}
              style={[tw`rounded-full border px-3 py-1.5`, selected ? tw`border-teal bg-[#E6F7F7]` : tw`border-slate-200`]}>
              <Text style={[tw`text-xs`, selected ? tw`font-bold text-navy` : tw`text-dark-gray`]}>{formatHours(m / 60)}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={tw`mt-4 text-sm font-bold text-cool-black`}>Location</Text>
      <TextInput value={location} onChangeText={setLocation} maxLength={300} placeholder="Optional" placeholderTextColor={colors.slate400} accessibilityLabel="Location" style={inputStyle} />

      <Text style={tw`mt-4 text-sm font-bold text-cool-black`}>Invite</Text>
      {invited.length > 0 ? (
        <View style={tw`mt-2 flex-row flex-wrap gap-1.5`}>
          {invited.map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${p.name}`}
              onPress={() => setInvited((list) => list.filter((x) => x.id !== p.id))}
              style={tw`flex-row items-center gap-1.5 rounded-full bg-pale-blue py-1 pl-1 pr-2.5`}>
              <Avatar name={p.name} size="xs" />
              <Text style={tw`text-xs font-bold text-navy`}>{p.name}</Text>
              <X size={12} color={colors.navy} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={tw`mt-2 h-11 flex-row items-center gap-2 rounded-xl border border-slate-200 bg-white px-3`}>
        <Search size={16} color={colors.slate400} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search people by name"
          placeholderTextColor={colors.slate400}
          accessibilityLabel="Search people to invite"
          autoCorrect={false}
          style={[tw`flex-1 text-sm text-cool-black`, { fontFamily: fonts.body }]}
        />
        {searching ? <ActivityIndicator size="small" color={colors.teal} /> : null}
      </View>
      {matches.length > 0 ? (
        <View style={tw`mt-1.5 overflow-hidden rounded-xl border border-slate-200`}>
          {matches.map((p, i) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`Invite ${p.name}`}
              onPress={() => {
                setInvited((list) => [...list, p]);
                setQuery('');
              }}
              style={({ pressed }) => [tw`flex-row items-center gap-2.5 px-3 py-2`, i > 0 && tw`border-t border-slate-100`, pressed && tw`bg-slate-50`]}>
              <Avatar name={p.name} size="xs" />
              <View style={tw`flex-1`}>
                <Text style={tw`text-sm text-cool-black`}>{p.name}</Text>
                {p.title ? <Text style={tw`text-xs text-slate-500`}>{p.title}</Text> : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={tw`mt-5 gap-3`}>
        <View style={tw`flex-row items-center gap-3`}>
          <View style={tw`flex-1`}>
            <Text style={tw`text-sm font-bold text-cool-black`}>Add to Google Calendar</Text>
            <Text style={tw`text-xs text-slate-500`}>On your linked calendar, with email invites</Text>
          </View>
          <Switch
            accessibilityLabel="Add to Google Calendar"
            value={addToGoogle}
            onValueChange={setAddToGoogle}
            trackColor={{ true: colors.teal, false: colors.slate300 }}
            thumbColor={colors.white}
            ios_backgroundColor={colors.slate300}
          />
        </View>
        <View style={[tw`flex-row items-center gap-3`, !addToGoogle && tw`opacity-50`]}>
          <Text style={tw`flex-1 text-sm font-bold text-cool-black`}>Google Meet link</Text>
          <Switch
            accessibilityLabel="Add a Google Meet link"
            value={addToGoogle && addMeet}
            disabled={!addToGoogle}
            onValueChange={setAddMeet}
            trackColor={{ true: colors.teal, false: colors.slate300 }}
            thumbColor={colors.white}
            ios_backgroundColor={colors.slate300}
          />
        </View>
      </View>

      {error ? (
        <Text accessibilityLiveRegion="polite" style={tw`mt-3 text-sm text-dark-coral`}>
          {error}
        </Text>
      ) : null}
    </BottomSheet>
  );
}
