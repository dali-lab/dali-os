import React from 'react';
import { Pressable, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import type { Task } from '../../types/project';
import { STATUS_META } from '../../utils/taskStatus';
import { formatShortDate } from '../../utils/time';
import { Text } from '../ui/Text';

export function TaskRow({ task, onOpen, first }: { task: Task; onOpen: () => void; first?: boolean }) {
  const meta = STATUS_META[task.status];
  const done = task.status === 'Done' || task.status === 'Cancelled';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [
        tw`flex-row items-center gap-3 px-3 py-3`,
        !first && tw`border-t border-slate-100`,
        pressed && tw`bg-slate-50`,
      ]}>
      <View style={[tw`h-2.5 w-2.5 rounded-full`, tw.style(meta.dot)]} />
      <View style={tw`flex-1`}>
        <Text
          numberOfLines={1}
          style={[tw`text-sm`, done ? [tw`text-slate-400`, { textDecorationLine: 'line-through' }] : tw`font-bold text-cool-black`]}>
          {task.title}
        </Text>
        <Text numberOfLines={1} style={tw`text-xs text-slate-500`}>
          {meta.label}
          {task.dueDate ? ` · Due ${formatShortDate(task.dueDate)}` : ''}
          {task.role ? ` · ${task.role}` : ''}
        </Text>
      </View>
      <ChevronRight size={16} color={colors.slate300} />
    </Pressable>
  );
}
