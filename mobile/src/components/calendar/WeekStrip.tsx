import React from 'react';
import { Pressable, View } from 'react-native';
import { addDays, format, isSameDay } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import type { CalendarEvent } from '../../types/calendar';
import { now } from '../../utils/time';
import { IconButton } from '../ui/IconButton';
import { Text } from '../ui/Text';

interface WeekStripProps {
  weekStart: Date;
  selected: Date;
  events: CalendarEvent[];
  onSelect: (day: Date) => void;
  onPrev: () => void;
  onNext: () => void;
}

export function WeekStrip({ weekStart, selected, events, onSelect, onPrev, onNext }: WeekStripProps) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <View style={tw`flex-row items-center gap-1 border-b border-slate-200 bg-white px-1 pb-3 pt-2`}>
      <IconButton label="Previous week" size="sm" onPress={onPrev}>
        <ChevronLeft size={18} color={colors.navy} />
      </IconButton>
      <View accessibilityLabel="Choose a day" style={tw`flex-1 flex-row gap-0.5`}>
        {days.map((day) => {
          const isSelected = isSameDay(day, selected);
          const isToday = isSameDay(day, now());
          const count = events.filter((e) => !e.isAllDay && isSameDay(new Date(e.start), day)).length;
          return (
            <Pressable
              key={day.toISOString()}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${format(day, 'EEEE, MMMM d')}${count ? `, ${count} events` : ''}`}
              onPress={() => onSelect(day)}
              style={({ pressed }) => [
                tw`flex-1 items-center gap-1 rounded-xl py-1.5`,
                isSelected ? tw`bg-navy` : pressed ? tw`bg-slate-100` : null,
              ]}>
              <Text style={[tw`font-eyebrow text-[10px] uppercase`, isSelected ? tw`text-pale-blue` : tw`text-slate-400`]}>
                {format(day, 'EEEEE')}
              </Text>
              <Text style={[tw`text-base font-bold`, isSelected ? tw`text-white` : isToday ? tw`text-teal` : tw`text-cool-black`]}>
                {format(day, 'd')}
              </Text>
              <View style={tw`h-1 flex-row gap-0.5`}>
                {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
                  <View key={i} style={[tw`h-1 w-1 rounded-full`, isSelected ? tw`bg-pale-teal` : tw`bg-teal`]} />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
      <IconButton label="Next week" size="sm" onPress={onNext}>
        <ChevronRight size={18} color={colors.navy} />
      </IconButton>
    </View>
  );
}
