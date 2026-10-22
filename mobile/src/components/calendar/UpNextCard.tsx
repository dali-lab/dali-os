import React from 'react';
import { Pressable, View } from 'react-native';
import { Clock, MapPin } from 'lucide-react-native';
import { tw } from '../../theme';
import { useMembers } from '../../contexts/useMembers';
import type { CalendarEvent } from '../../types/calendar';
import { formatCountdown, formatTimeRange } from '../../utils/time';
import { AvatarStack } from '../ui/AvatarStack';
import { Text } from '../ui/Text';

const SOFT_WHITE = 'rgba(255,255,255,0.9)';

export function UpNextCard({ event, onOpen }: { event: CalendarEvent; onOpen: () => void }) {
  const { getMember } = useMembers();
  return (
    <View style={tw`px-4 pt-4`}>
      <View style={tw`rounded-2xl bg-teal p-4`}>
        <Text style={tw`font-eyebrow text-[11px] uppercase tracking-widest text-white/85`}>Up next · {formatCountdown(event.start)}</Text>
        <Text style={tw`mt-1.5 font-heading text-xl leading-snug text-white`}>{event.title}</Text>
        <View style={tw`mt-2 gap-1`}>
          <View style={tw`flex-row items-center gap-1.5`}>
            <Clock size={14} color={SOFT_WHITE} />
            <Text style={tw`text-sm text-white/90`}>{formatTimeRange(event.start, event.end)}</Text>
          </View>
          {event.location ? (
            <View style={tw`flex-row items-center gap-1.5`}>
              <MapPin size={14} color={SOFT_WHITE} />
              <Text style={tw`text-sm text-white/90`}>{event.location}</Text>
            </View>
          ) : null}
        </View>
        <View style={tw`mt-3 flex-row items-center justify-between`}>
          <AvatarStack names={event.attendeeIds.map((id) => getMember(id)?.name ?? '?')} overlap={6} />
          <Pressable
            accessibilityRole="button"
            onPress={onOpen}
            style={({ pressed }) => [tw`rounded-full px-3.5 py-1.5`, pressed ? tw`bg-cool-white` : tw`bg-white`]}>
            <Text style={tw`text-sm font-bold text-navy`}>View details</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
