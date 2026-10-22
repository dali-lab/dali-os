import React from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, FolderKanban, MessageSquare, Ticket, type LucideIcon } from 'lucide-react-native';
import { colors, tw } from '../theme';
import { useChat } from '../contexts/ChatContext';
import type { TabId } from '../types/navigation';
import { unreadCount } from '../utils/chat';
import { Text } from './ui/Text';

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'project', label: 'Project', icon: FolderKanban },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'pass', label: 'Pass', icon: Ticket },
];

export function TabBar({ active, onChange }: { active: TabId; onChange: (tab: TabId) => void }) {
  const insets = useSafeAreaInsets();
  const { conversations, messages, meId } = useChat();
  const unread = conversations.reduce((sum, c) => sum + unreadCount(c, messages, meId), 0);

  return (
    <View accessibilityRole="tabbar" style={[tw`flex-row border-t border-slate-200 bg-white`, { paddingBottom: insets.bottom }]}>
      {TABS.map(({ id, label, icon: I }) => {
        const isActive = id === active;
        const tint = isActive ? colors.teal : colors.slate400;
        return (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={id === 'chat' && unread > 0 ? `${label}, ${unread} unread messages` : label}
            onPress={() => onChange(id)}
            style={tw`h-16 flex-1 items-center justify-center gap-0.5`}>
            <View>
              <I size={22} color={tint} strokeWidth={isActive ? 2.4 : 2} />
              {id === 'chat' && unread > 0 ? (
                <View style={tw`absolute -right-2.5 -top-1.5 h-4 min-w-4 items-center justify-center rounded-full bg-coral px-1`}>
                  <Text style={tw`text-[10px] font-bold text-white`}>{unread}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[tw`text-[11px]`, { color: tint }, isActive && tw`font-bold`]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
