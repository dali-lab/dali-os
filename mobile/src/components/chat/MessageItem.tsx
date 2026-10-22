import React from 'react';
import { Pressable, View } from 'react-native';
import { SmilePlus } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import { useChat } from '../../contexts/ChatContext';
import type { Message } from '../../types/chat';
import { formatClock } from '../../utils/time';
import { Avatar } from '../ui/Avatar';
import { Text } from '../ui/Text';

interface MessageItemProps {
  message: Message;
  compact?: boolean;
  replyCount?: number;
  lastReplyAt?: string;
  replyAuthorIds?: string[];
  onOpenThread?: () => void;
  onOpenActions?: () => void;
}

export function MessageItem({ message, compact, replyCount = 0, lastReplyAt, replyAuthorIds = [], onOpenThread, onOpenActions }: MessageItemProps) {
  const { getUser, meId, users, toggleReaction } = useChat();
  const author = getUser(message.authorId);

  if (message.kind === 'system') {
    return (
      <View style={tw`flex-row items-center gap-2 px-4 py-1.5`}>
        <Avatar name={author?.name ?? 'Someone'} size="xs" />
        <Text style={tw`flex-1 text-[13px] text-slate-500`}>
          <Text style={tw`font-bold text-dark-gray`}>{author?.name}</Text> {message.text}
        </Text>
        <Text style={tw`text-[11px] text-slate-400`}>{formatClock(message.createdAt)}</Text>
      </View>
    );
  }

  const renderText = (text: string) =>
    text.split(/(@[a-z0-9_]+)/gi).map((part, i) => {
      if (!part.startsWith('@')) return part;
      const user = users.find((u) => u.handle === part.slice(1).toLowerCase());
      if (!user) return part;
      return (
        <Text key={i} style={[tw`font-bold`, user.id === meId ? tw`bg-light-yellow text-dark-navy` : tw`text-teal`]}>
          {part}
        </Text>
      );
    });

  const body = <Text style={tw`text-[15px] leading-snug text-dark-gray`}>{renderText(message.text)}</Text>;

  return (
    <View style={compact ? tw`px-4 py-0.5` : tw`px-4 pb-1 pt-2.5`}>
      <View style={tw`flex-row gap-3`}>
        <View style={tw`w-8`}>{!compact ? <Avatar name={author?.name ?? 'Unknown'} size="sm" /> : null}</View>
        <View style={tw`flex-1`}>
          {!compact ? (
            <View style={tw`flex-row items-baseline gap-2`}>
              <Text style={tw`text-sm font-bold text-cool-black`}>{author?.name}</Text>
              <Text style={tw`text-[11px] text-slate-400`}>{formatClock(message.createdAt)}</Text>
            </View>
          ) : null}
          {onOpenActions ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Message from ${author?.name}: ${message.text}. Open message actions`}
              onLongPress={onOpenActions}
              onPress={onOpenActions}
              style={({ pressed }) => [pressed && tw`bg-slate-50`]}>
              {body}
            </Pressable>
          ) : (
            body
          )}

          {message.reactions.length > 0 ? (
            <View style={tw`mt-1.5 flex-row flex-wrap items-center gap-1`}>
              {message.reactions.map((r) => {
                const mine = r.userIds.includes(meId);
                return (
                  <Pressable
                    key={r.emoji}
                    accessibilityRole="button"
                    accessibilityState={{ selected: mine }}
                    accessibilityLabel={`${r.emoji} ${r.userIds.length} reaction${r.userIds.length > 1 ? 's' : ''}`}
                    onPress={() => toggleReaction(message.id, r.emoji)}
                    style={[
                      tw`flex-row items-center gap-1 rounded-full border px-2 py-0.5`,
                      mine ? tw`border-teal bg-[#E6F7F7]` : tw`border-slate-200 bg-white`,
                    ]}>
                    <Text style={tw`text-xs`}>{r.emoji}</Text>
                    <Text style={[tw`text-xs font-bold`, mine ? tw`text-navy` : tw`text-dark-gray`]}>{r.userIds.length}</Text>
                  </Pressable>
                );
              })}
              {onOpenActions ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add a reaction"
                  onPress={onOpenActions}
                  style={tw`h-[22px] w-8 items-center justify-center rounded-full border border-slate-200 bg-white`}>
                  <SmilePlus size={13} color={colors.slate400} />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {replyCount > 0 && onOpenThread ? (
            <Pressable accessibilityRole="button" onPress={onOpenThread} style={tw`mt-1.5 flex-row items-center gap-2 py-0.5`}>
              <View style={tw`flex-row`}>
                {replyAuthorIds.slice(0, 3).map((id, i) => (
                  <View key={id} style={i > 0 ? tw`-ml-1.5` : undefined}>
                    <Avatar name={getUser(id)?.name ?? '?'} size="xs" ring />
                  </View>
                ))}
              </View>
              <Text numberOfLines={1} style={tw`flex-1 text-[13px] font-bold text-teal`}>
                {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
                {lastReplyAt ? <Text style={tw`text-slate-400`}> · Last reply {formatClock(lastReplyAt)}</Text> : null}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}
