import React from 'react';
import { View } from 'react-native';
import { Calendar, MessageSquare, Paperclip, PartyPopper } from 'lucide-react-native';
import { colors, shadow, tw } from '../../theme';
import { useMembers } from '../../contexts/useMembers';
import type { Epic, Task, TaskStatus } from '../../types/project';
import { roleTone } from '../../utils/roles';
import { STATUS_META, nextStep } from '../../utils/taskStatus';
import { formatShortDate } from '../../utils/time';
import { AvatarStack } from '../ui/AvatarStack';
import { Button } from '../ui/Button';
import { Eyebrow } from '../ui/Eyebrow';
import { Tag } from '../ui/Tag';
import { Text } from '../ui/Text';

interface FocusTaskCardProps {
  task?: Task;
  epic?: Epic;
  onOpen: (id: string) => void;
  onChangeStatus: (id: string, status: TaskStatus) => void;
}

function Meta({ icon: I, children }: { icon: typeof Calendar; children: React.ReactNode }) {
  return (
    <View style={tw`flex-row items-center gap-1`}>
      <I size={13} color={colors.slate500} />
      <Text style={tw`text-xs text-slate-500`}>{children}</Text>
    </View>
  );
}

export function FocusTaskCard({ task, epic, onOpen, onChangeStatus }: FocusTaskCardProps) {
  const { getMember } = useMembers();
  const step = task ? nextStep(task.status) : null;

  return (
    <View style={tw`px-4 pt-6`}>
      <Eyebrow>Your immediate task</Eyebrow>
      {!task ? (
        <View style={[tw`mt-2 items-center rounded-2xl border border-medium-gray bg-white px-6 py-8`, { borderStyle: 'dashed' }]}>
          <PartyPopper size={28} color={colors.teal} />
          <Text style={tw`mt-2 font-bold text-cool-black`}>You’re all caught up</Text>
          <Text style={tw`text-center text-sm text-slate-500`}>Pick something up from the backlog in DALI OS.</Text>
        </View>
      ) : (
        <View style={[tw`mt-2 rounded-2xl border border-l-4 border-slate-200 border-l-teal bg-white p-4`, shadow.sm]}>
          <View style={tw`flex-row items-center gap-2`}>
            <View style={[tw`flex-row items-center gap-1.5 rounded-full px-2 py-0.5`, tw.style(STATUS_META[task.status].soft)]}>
              <View style={[tw`h-1.5 w-1.5 rounded-full`, tw.style(STATUS_META[task.status].dot)]} />
              <Text style={[tw`text-xs font-bold`, tw.style(STATUS_META[task.status].text)]}>{STATUS_META[task.status].label}</Text>
            </View>
            {epic ? (
              <Text numberOfLines={1} style={tw`flex-1 font-eyebrow text-[11px] uppercase tracking-wider text-slate-400`}>
                {epic.name}
              </Text>
            ) : null}
          </View>
          <Text style={tw`mt-2 font-heading text-lg leading-snug text-cool-black`}>{task.title}</Text>
          {task.description ? (
            <Text numberOfLines={2} style={tw`mt-1 text-sm text-dark-gray`}>
              {task.description}
            </Text>
          ) : null}

          <View style={[tw`mt-3 flex-row flex-wrap items-center`, { columnGap: 12, rowGap: 6 }]}>
            {task.dueDate ? <Meta icon={Calendar}>Due {formatShortDate(task.dueDate)}</Meta> : null}
            {task.attachmentCount > 0 ? <Meta icon={Paperclip}>{task.attachmentCount}</Meta> : null}
            {task.commentCount > 0 ? <Meta icon={MessageSquare}>{task.commentCount}</Meta> : null}
            {task.role ? (
              <Tag size="sm" tone={roleTone(task.role)}>
                {task.role}
              </Tag>
            ) : null}
          </View>

          <View style={tw`mt-3 flex-row items-center gap-2`}>
            <AvatarStack names={task.assigneeIds.map((id) => getMember(id)?.name ?? '?')} overlap={6} />
            <Text numberOfLines={1} style={tw`flex-1 text-xs text-slate-500`}>
              {task.assigneeIds.map((id) => getMember(id)?.name.split(' ')[0]).join(', ')}
            </Text>
          </View>

          <View style={tw`mt-4 flex-row gap-2`}>
            {step ? (
              <View style={tw`flex-1`}>
                <Button size="sm" shape="rounded" fullWidth onPress={() => onChangeStatus(task.id, step.status)}>
                  {step.label}
                </Button>
              </View>
            ) : null}
            <Button size="sm" shape="rounded" variant="outline" color="navy" onPress={() => onOpen(task.id)}>
              Details
            </Button>
          </View>
        </View>
      )}
    </View>
  );
}
