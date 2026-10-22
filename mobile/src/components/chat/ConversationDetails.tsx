import React from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Hash, Lock, LogOut, UserPlus, type LucideIcon } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import { useChat } from '../../contexts/ChatContext';
import type { User } from '../../types/user';
import { conversationTitle } from '../../utils/chat';
import { NavHeader } from '../NavHeader';
import { PresenceDot } from '../PresenceDot';
import { Avatar } from '../ui/Avatar';
import { Eyebrow } from '../ui/Eyebrow';
import { Tag } from '../ui/Tag';
import { Text } from '../ui/Text';

interface ConversationDetailsProps {
  conversationId: string;
  onBack: () => void;
  onInvite: () => void;
  onLeft: () => void;
}

function ActionTile({ icon: I, label, color, onPress }: { icon: LucideIcon; label: string; color: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [tw`flex-1 items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-3`, pressed ? tw`bg-slate-50` : tw`bg-white`]}>
      <I size={20} color={color} />
      <Text style={[tw`text-sm font-bold`, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function ConversationDetails({ conversationId, onBack, onInvite, onLeft }: ConversationDetailsProps) {
  const { conversations, users, meId, getUser, leaveChannel } = useChat();
  const conversation = conversations.find((c) => c.id === conversationId);
  if (!conversation) return null;

  const isChannel = conversation.kind === 'channel';
  const isMember = conversation.memberIds.includes(meId);
  const title = conversationTitle(conversation, users, meId);
  const members = conversation.memberIds
    .map(getUser)
    .filter((u): u is User => Boolean(u))
    .sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : a.name.localeCompare(b.name)));
  const canLeave = isChannel && isMember && !conversation.isDefault;

  const handleLeave = () => {
    Alert.alert(
      `Leave #${title}?`,
      conversation.isPrivate ? 'You’ll need to be invited again to rejoin.' : 'You can rejoin any time from Browse channels.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => {
            leaveChannel(conversationId);
            onLeft();
          },
        },
      ],
    );
  };

  return (
    <View style={tw`flex-1 bg-cool-white`}>
      <NavHeader onBack={onBack} title="Details" />
      <ScrollView style={tw`flex-1`} contentContainerStyle={tw`pb-6`}>
        <View style={tw`items-center border-b border-slate-200 bg-white px-6 py-6`}>
          {isChannel ? (
            <View style={tw`h-14 w-14 items-center justify-center rounded-2xl bg-pale-blue`}>
              {conversation.isPrivate ? <Lock size={24} color={colors.navy} /> : <Hash size={24} color={colors.navy} />}
            </View>
          ) : (
            <Avatar name={title} size="lg" />
          )}
          <Text accessibilityRole="header" style={tw`mt-3 text-center font-heading text-xl text-cool-black`}>
            {isChannel ? `#${title}` : title}
          </Text>
          <View style={tw`mt-2`}>
            {isChannel ? (
              <Tag
                tone={conversation.isPrivate ? 'amber' : 'green'}
                icon={conversation.isPrivate ? <Lock size={12} color="#92400E" /> : <Hash size={12} color="#047857" />}>
                {conversation.isPrivate ? 'Private channel' : 'Public channel'}
              </Tag>
            ) : (
              <Tag tone="blue">{members.length > 2 ? 'Group message' : 'Direct message'}</Tag>
            )}
          </View>
          {conversation.topic ? <Text style={tw`mt-3 text-center text-sm text-dark-gray`}>{conversation.topic}</Text> : null}
        </View>

        {isMember ? (
          <View style={tw`flex-row gap-2 p-4`}>
            <ActionTile icon={UserPlus} label={isChannel ? 'Add people' : 'Add to group'} color={colors.navy} onPress={onInvite} />
            {canLeave ? <ActionTile icon={LogOut} label="Leave channel" color={colors.coral} onPress={handleLeave} /> : null}
          </View>
        ) : null}

        <View style={tw`px-4 pt-2`}>
          <Eyebrow>Members · {members.length}</Eyebrow>
          <View style={tw`mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white`}>
            {members.map((u, i) => (
              <View key={u.id} style={[tw`flex-row items-center gap-3 px-3 py-2.5`, i > 0 && tw`border-t border-slate-100`]}>
                <View>
                  <Avatar name={u.name} size="sm" />
                  <PresenceDot presence={u.presence} />
                </View>
                <View style={tw`flex-1`}>
                  <Text numberOfLines={1} style={tw`text-sm font-bold text-cool-black`}>
                    {u.name}
                    {u.id === meId ? <Text style={tw`text-slate-400`}> (you)</Text> : null}
                  </Text>
                  <Text numberOfLines={1} style={tw`text-xs text-slate-500`}>
                    {u.title}
                  </Text>
                </View>
                {conversation.createdBy === u.id && isChannel ? <Tag size="sm">Creator</Tag> : null}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
