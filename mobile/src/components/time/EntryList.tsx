import React from 'react';
import { Pressable, View } from 'react-native';
import { Calendar, Pencil, Trash2 } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import type { Role, TimeEntry } from '../../api/contract';
import { formatHours, fromDateKey } from '../../utils/hours';
import { roleColor } from '../../utils/roleColor';
import { formatDayLabel, formatTimeRange } from '../../utils/time';
import { SwipeRow } from '../ui/SwipeRow';
import { Text } from '../ui/Text';

export function entryTitle(entry: TimeEntry, role: Role | undefined): string {
  return entry.meetingTitle ?? entry.note ?? `${role?.label ?? 'Work'} time`;
}

interface EntryListProps {
  entries: TimeEntry[];
  roles: Role[];
  onOpen: (entry: TimeEntry) => void;
  onDelete: (entry: TimeEntry) => void;
}

export function EntryList({ entries, roles, onOpen, onDelete }: EntryListProps) {
  const roleIds = roles.map((r) => r.roleRefId);
  const days = Array.from(new Set(entries.map((e) => e.day))).sort((a, b) => b.localeCompare(a));

  if (entries.length === 0) {
    return (
      <View style={[tw`mt-2 rounded-xl border border-medium-gray bg-white px-4 py-6`, { borderStyle: 'dashed' }]}>
        <Text style={tw`text-center text-sm text-slate-500`}>No time logged this period yet. Clock in to get started.</Text>
      </View>
    );
  }

  return (
    <View style={tw`mt-2 gap-4`}>
      {days.map((day) => {
        const dayEntries = entries
          .filter((e) => e.day === day)
          .sort((a, b) => (b.startTime ?? '').localeCompare(a.startTime ?? ''));
        const dayTotal = dayEntries.reduce((s, e) => s + e.hours, 0);
        return (
          <View key={day}>
            <View style={tw`flex-row items-baseline justify-between px-1`}>
              <Text accessibilityRole="header" style={tw`text-xs font-bold text-dark-gray`}>
                {formatDayLabel(fromDateKey(day))}
              </Text>
              <Text style={tw`text-xs text-slate-500`}>{formatHours(dayTotal)}</Text>
            </View>
            <View style={tw`mt-1.5 overflow-hidden rounded-xl border border-slate-200 bg-white`}>
              {dayEntries.map((e, i) => {
                const role = roles.find((r) => r.roleRefId === e.roleRefId);
                const SourceIcon = e.source === 'Meeting' ? Calendar : Pencil;
                const range = e.startTime && e.endTime ? formatTimeRange(e.startTime, e.endTime) : null;
                return (
                  <View key={e.id} style={i > 0 && tw`border-t border-slate-100`}>
                  <SwipeRow
                    actions={[
                      { label: 'Edit', icon: Pencil, color: colors.navy, onPress: () => onOpen(e) },
                      { label: e.source === 'Meeting' ? 'Remove' : 'Delete', icon: Trash2, color: colors.coral, onPress: () => onDelete(e) },
                    ]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityHint={e.source === 'Meeting' ? 'From a meeting' : 'Added by you'}
                    onPress={() => onOpen(e)}
                    style={({ pressed }) => [tw`flex-row items-center gap-3 px-3 py-2.5`, pressed && tw`bg-slate-50`]}>
                    <View style={[tw`h-8 w-1 rounded-full`, { backgroundColor: roleColor(roleIds, e.roleRefId) }]} />
                    <View style={tw`flex-1`}>
                      <Text numberOfLines={1} style={tw`text-sm font-bold text-cool-black`}>
                        {entryTitle(e, role)}
                      </Text>
                      <View style={tw`flex-row items-center gap-1`}>
                        <SourceIcon size={11} color={colors.slate500} />
                        <Text numberOfLines={1} style={tw`flex-1 text-xs text-slate-500`}>
                          {[range, role?.label ?? (e.roleRefId ? null : 'No role yet')].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                    </View>
                    <Text style={[tw`text-sm font-bold text-navy`, { fontVariant: ['tabular-nums'] }]}>{formatHours(e.hours)}</Text>
                  </Pressable>
                  </SwipeRow>
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}
