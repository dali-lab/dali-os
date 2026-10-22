import React, { useRef } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { format } from 'date-fns';
import { Calendar, Clock, MapPin, NotebookPen, Video, type LucideIcon } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import { useMembers } from '../../contexts/useMembers';
import type { CalendarEvent, Rsvp } from '../../types/calendar';
import { CATEGORY_META } from '../../utils/eventCategory';
import { formatTimeRange } from '../../utils/time';
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
}

function Detail({ icon: I, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <View style={tw`flex-row items-center gap-2.5`}>
      <I size={16} color={colors.slate400} />
      <Text style={tw`flex-1 text-sm text-dark-gray`}>{children}</Text>
    </View>
  );
}

export function EventDetailSheet({ event, onClose, onRsvp }: EventDetailSheetProps) {
  const { getMember, meId } = useMembers();
  const last = useRef<CalendarEvent | undefined>(event);
  if (event) last.current = event;
  const shown = event ?? last.current;
  const hasAttendees = Boolean(shown && shown.attendeeIds.length > 0);

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
              From <Text style={tw`font-bold text-dark-gray`}>{shown.calendar}</Text>. RSVPs sync with DALI OS.
            </Text>
          </View>
        </>
      ) : null}
    </BottomSheet>
  );
}
