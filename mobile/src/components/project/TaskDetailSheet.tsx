import React, { useRef } from 'react';
import { Pressable, View } from 'react-native';
import { Check, Link, RefreshCw } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import { useMembers } from '../../contexts/useMembers';
import type { Epic, Task, TaskStatus } from '../../types/project';
import { roleTone } from '../../utils/roles';
import { STATUS_META, TASK_STATUSES } from '../../utils/taskStatus';
import { formatShortDate } from '../../utils/time';
import { Avatar } from '../ui/Avatar';
import { BottomSheet } from '../ui/BottomSheet';
import { Eyebrow } from '../ui/Eyebrow';
import { Tag } from '../ui/Tag';
import { Text } from '../ui/Text';

interface TaskDetailSheetProps {
  task?: Task;
  epics: Epic[];
  onClose: () => void;
  onChangeStatus: (id: string, status: TaskStatus) => void;
}

function Row({ label, children, alignTop }: { label: string; children: React.ReactNode; alignTop?: boolean }) {
  return (
    <View style={[tw`flex-row justify-between gap-4`, alignTop ? tw`items-start` : tw`items-center`]}>
      <Text style={tw`text-sm text-slate-500`}>{label}</Text>
      {children}
    </View>
  );
}

export function TaskDetailSheet({ task, epics, onClose, onChangeStatus }: TaskDetailSheetProps) {
  const { getMember } = useMembers();
  const lastTask = useRef<Task | undefined>(task);
  if (task) lastTask.current = task;
  const shown = task ?? lastTask.current;
  const epic = epics.find((e) => e.id === shown?.epicId);

  const dates =
    shown?.startDate && shown?.dueDate
      ? `${formatShortDate(shown.startDate)} – ${formatShortDate(shown.dueDate)}`
      : shown?.dueDate
        ? `Due ${formatShortDate(shown.dueDate)}`
        : 'No dates set';

  return (
    <BottomSheet open={Boolean(task)} onClose={onClose} title="Task">
      {shown ? (
        <>
          {epic ? <Eyebrow style={tw`text-teal`}>{epic.name}</Eyebrow> : null}
          <Text style={tw`mt-1 font-heading text-xl leading-snug text-cool-black`}>{shown.title}</Text>
          {shown.description ? <Text style={tw`mt-2 text-sm text-dark-gray`}>{shown.description}</Text> : null}

          <View style={tw`mt-5`}>
            <Eyebrow>Status</Eyebrow>
            <View accessibilityRole="radiogroup" style={tw`mt-2 overflow-hidden rounded-xl border border-slate-200`}>
              {TASK_STATUSES.map((s, i) => {
                const selected = shown.status === s;
                return (
                  <Pressable
                    key={s}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => onChangeStatus(shown.id, s)}
                    style={({ pressed }) => [
                      tw`flex-row items-center gap-3 px-3 py-2.5`,
                      i > 0 && tw`border-t border-slate-100`,
                      selected ? tw`bg-[#E6F7F7]` : pressed ? tw`bg-slate-50` : null,
                    ]}>
                    <View style={[tw`h-2.5 w-2.5 rounded-full`, tw.style(STATUS_META[s].dot)]} />
                    <Text style={[tw`flex-1 text-sm`, selected ? tw`font-bold text-navy` : tw`text-dark-gray`]}>{STATUS_META[s].label}</Text>
                    {selected ? <Check size={16} color={colors.teal} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={tw`mt-5 gap-3`}>
            <Row label="Assignees" alignTop>
              <View style={tw`items-end gap-1.5`}>
                {shown.assigneeIds.length === 0 ? <Text style={tw`text-sm text-slate-400`}>Unassigned</Text> : null}
                {shown.assigneeIds.map((id) => (
                  <View key={id} style={tw`flex-row items-center gap-2`}>
                    <Avatar name={getMember(id)?.name ?? '?'} size="xs" />
                    <Text style={tw`text-sm text-cool-black`}>{getMember(id)?.name}</Text>
                  </View>
                ))}
              </View>
            </Row>
            <Row label="Dates">
              <Text style={tw`text-sm text-cool-black`}>{dates}</Text>
            </Row>
            {shown.role ? (
              <Row label="Role">
                <Tag size="sm" tone={roleTone(shown.role)}>
                  {shown.role}
                </Tag>
              </Row>
            ) : null}
            <Row label="Activity">
              <Text style={tw`text-sm text-cool-black`}>
                {shown.commentCount} comments · {shown.attachmentCount} files
              </Text>
            </Row>
            {shown.linkRef ? (
              <Row label="Linked">
                <View style={tw`flex-row items-center gap-1`}>
                  <Link size={13} color={colors.teal} />
                  <Text style={tw`text-sm text-teal`}>#{shown.linkRef}</Text>
                </View>
              </Row>
            ) : null}
          </View>

          <View style={tw`mt-5 flex-row items-center gap-2`}>
            <RefreshCw size={12} color={colors.slate500} />
            <Text style={tw`text-xs text-slate-500`}>Status changes sync to the DALI OS board</Text>
          </View>
        </>
      ) : null}
    </BottomSheet>
  );
}
