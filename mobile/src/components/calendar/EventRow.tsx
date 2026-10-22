import React from 'react';
import { Pressable, View } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import type { CalendarEvent } from '../../types/calendar';
import { CATEGORY_META, RSVP_LABEL } from '../../utils/eventCategory';
import { formatClock, formatDuration, now, toMs } from '../../utils/time';
import { Text } from '../ui/Text';

export function EventRow({ event, onOpen }: { event: CalendarEvent; onOpen: () => void }) {
  const isPast = toMs(event.end) < now().getTime();
  const isNow = toMs(event.start) <= now().getTime() && !isPast;
  const declined = event.rsvp === 'declined';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [
        tw`flex-row gap-3 rounded-xl border bg-white p-3`,
        pressed ? tw`border-medium-gray` : tw`border-slate-200`,
        isPast && { opacity: 0.55 },
      ]}>
      <View style={tw`w-14 items-end pt-0.5`}>
        <Text style={tw`text-sm font-bold text-cool-black`}>{formatClock(event.start).replace(' ', ' ')}</Text>
        <Text style={tw`text-[11px] text-slate-400`}>{formatDuration(event.start, event.end)}</Text>
      </View>
      <View style={[tw`w-1 rounded-full`, tw.style(CATEGORY_META[event.category].bar)]} />
      <View style={tw`flex-1`}>
        <Text numberOfLines={1} style={[tw`text-sm font-bold text-cool-black`, declined && { textDecorationLine: 'line-through' }]}>
          {event.title}
        </Text>
        {event.location ? (
          <View style={tw`mt-0.5 flex-row items-center gap-1`}>
            <MapPin size={12} color={colors.slate500} />
            <Text numberOfLines={1} style={tw`flex-1 text-xs text-slate-500`}>
              {event.location}
            </Text>
          </View>
        ) : null}
        <View style={tw`mt-1 flex-row items-center gap-2`}>
          <Text style={tw`font-eyebrow text-[11px] uppercase tracking-wider text-slate-400`}>{CATEGORY_META[event.category].label}</Text>
          {event.rsvp === 'needs_action' ? <Text style={tw`text-[11px] font-bold text-coral`}>{RSVP_LABEL.needs_action}</Text> : null}
          {event.rsvp === 'tentative' ? <Text style={tw`text-[11px] font-bold text-dark-gray`}>Maybe</Text> : null}
          {isNow ? <Text style={tw`text-[11px] font-bold text-teal`}>Now</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}
