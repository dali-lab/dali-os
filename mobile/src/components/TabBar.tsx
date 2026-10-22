import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, FolderKanban, Mic, Ticket, Timer, type LucideIcon } from 'lucide-react-native';
import { colors, tw } from '../theme';
import { useNotes } from '../contexts/NotesContext';
import { useTime } from '../contexts/TimeContext';
import { useNow } from '../hooks/useNow';
import type { TabId } from '../types/navigation';
import { formatShortElapsed } from '../utils/hours';
import { Text } from './ui/Text';

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'time', label: 'Time', icon: Timer },
  { id: 'project', label: 'Project', icon: FolderKanban },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'notes', label: 'Notes', icon: Mic },
  { id: 'pass', label: 'Pass', icon: Ticket },
];

function RecordingDot() {
  const t = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        Animated.timing(t, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  return <Animated.View style={[tw`absolute -right-1 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-coral`, { opacity: t }]} />;
}

export function TabBar({ active, onChange }: { active: TabId; onChange: (tab: TabId) => void }) {
  const insets = useSafeAreaInsets();
  const { timer } = useTime();
  const { active: recording } = useNotes();
  const now = useNow(1000, Boolean(timer));
  const timerLabel = timer ? formatShortElapsed((now.getTime() - new Date(timer.startedAt).getTime()) / 1000) : null;
  const isRecording = recording?.phase === 'recording';

  return (
    <View accessibilityRole="tabbar" style={[tw`flex-row border-t border-slate-200 bg-white`, { paddingBottom: insets.bottom }]}>
      {TABS.map(({ id, label, icon: I }) => {
        const isActive = id === active;
        const tint = isActive ? colors.teal : colors.slate400;
        const showTimer = id === 'time' && timerLabel;
        const a11y = showTimer ? `${label}, clocked in` : id === 'notes' && isRecording ? `${label}, recording` : label;
        return (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={a11y}
            onPress={() => onChange(id)}
            style={tw`h-16 flex-1 items-center justify-center gap-0.5`}>
            <View>
              <I size={22} color={tint} strokeWidth={isActive ? 2.4 : 2} />
              {showTimer ? <View style={tw`absolute -right-1 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-light-green`} /> : null}
              {id === 'notes' && isRecording ? <RecordingDot /> : null}
            </View>
            <Text style={[tw`text-[11px]`, { color: showTimer ? colors.green : tint, fontVariant: ['tabular-nums'] }, (isActive || showTimer) && tw`font-bold`]}>
              {showTimer ? timerLabel : label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
