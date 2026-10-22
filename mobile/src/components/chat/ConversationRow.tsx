import React from 'react';
import { Pressable, View } from 'react-native';
import { Hash, Lock } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import { useChat } from '../../contexts/ChatContext';
import type { Conversation, Message } from '../../types/chat';
import type { User } from '../../types/user';
import { formatListTime } from '../../utils/time';
import { PresenceDot } from '../PresenceDot';
import { Avatar } from '../ui/Avatar';
import { Text } from '../ui/Text';

interface ConversationRowProps {
  conversation: Conversation;
  title: string;
  unread: number;
  lastMessage?: Message;
  onPress: () => void;
}

function UnreadBadge({ count }: { count: number }) {
  return (
    <View style={tw`h-5 min-w-5 items-center justify-center rounded-full bg-coral px-1.5`}>
      <Text style={tw`text-[11px] font-bold text-white`}>{count}</Text>
    </View>
  );
}

export function ConversationRow({ conversation, title, unread, lastMessage, onPress }: ConversationRowProps) {
  const { meId, getUser } = useChat();
  const hasUnread = unread > 0;
  const rowStyle = ({ pressed }: { pressed: boolean }) => [pressed && tw`bg-slate-100`];

  if (conversation.kind === 'channel') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}${conversation.isPrivate ? ', private' : ''}${hasUnread ? `, ${unread} unread` : ''}`}
        onPress={onPress}
        style={(s) => [tw`flex-row items-center gap-3 px-4 py-2`, ...rowStyle(s)]}>
        <View style={tw`h-8 w-8 items-center justify-center rounded-lg bg-pale-blue`}>
          {conversation.isPrivate ? <Lock size={15} color={colors.navy} /> : <Hash size={15} color={colors.navy} />}
        </View>
        <Text numberOfLines={1} style={[tw`flex-1 text-[15px]`, hasUnread ? tw`font-bold text-cool-black` : tw`text-dark-gray`]}>
          {title}
        </Text>
        {hasUnread ? <UnreadBadge count={unread} /> : null}
      </Pressable>
    );
  }

  const others = conversation.memberIds
    .filter((id) => id !== meId)
    .map(getUser)
    .filter((u): u is User => Boolean(u));
  const author = lastMessage ? getUser(lastMessage.authorId) : undefined;
  const prefix = !lastMessage ? '' : lastMessage.authorId === meId ? 'You: ' : others.length > 1 ? `${author?.name.split(' ')[0]}: ` : '';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}${hasUnread ? `, ${unread} unread` : ''}`}
      onPress={onPress}
      style={(s) => [tw`flex-row items-center gap-3 px-4 py-2.5`, ...rowStyle(s)]}>
      {others.length <= 1 ? (
        <View>
          <Avatar name={others[0]?.name ?? 'You'} size="sm" />
          {others[0] ? <PresenceDot presence={others[0].presence} /> : null}
        </View>
      ) : (
        <View style={tw`h-8 w-8`}>
          <View style={tw`absolute left-0 top-0`}>
            <Avatar name={others[0].name} size="xs" ring />
          </View>
          <View style={tw`absolute bottom-0 right-0`}>
            <Avatar name={others[1].name} size="xs" ring />
          </View>
        </View>
      )}
      <View style={tw`flex-1`}>
        <View style={tw`flex-row items-baseline justify-between gap-2`}>
          <Text numberOfLines={1} style={[tw`flex-1 text-[15px] text-cool-black`, hasUnread && tw`font-bold`]}>
            {title}
          </Text>
          {lastMessage ? <Text style={tw`text-[11px] text-slate-400`}>{formatListTime(lastMessage.createdAt)}</Text> : null}
        </View>
        <View style={tw`flex-row items-center justify-between gap-2`}>
          <Text numberOfLines={1} style={[tw`flex-1 text-[13px]`, hasUnread ? tw`text-cool-black` : tw`text-slate-500`]}>
            {lastMessage ? `${prefix}${lastMessage.text}` : 'Say hello 👋'}
          </Text>
          {hasUnread ? <UnreadBadge count={unread} /> : null}
        </View>
      </View>
    </Pressable>
  );
}
