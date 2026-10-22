import React, { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { isSameDay } from 'date-fns';
import { Hash, Info, Lock } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import { useChat } from '../../contexts/ChatContext';
import { conversationTitle, rootMessages, threadReplies } from '../../utils/chat';
import { formatDayLabel, toMs } from '../../utils/time';
import { NavHeader } from '../NavHeader';
import { PRESENCE_LABEL } from '../PresenceDot';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Text } from '../ui/Text';
import { Composer } from './Composer';
import { MessageActionsSheet } from './MessageActionsSheet';
import { MessageItem } from './MessageItem';

interface ConversationScreenProps {
  conversationId: string;
  onBack: () => void;
  onOpenThread: (messageId: string) => void;
  onOpenDetails: () => void;
}

export function ConversationScreen({ conversationId, onBack, onOpenThread, onOpenDetails }: ConversationScreenProps) {
  const { conversations, messages, users, meId, getUser, sendMessage, joinChannel, markRead } = useChat();
  const conversation = conversations.find((c) => c.id === conversationId);
  const [initialLastRead] = useState(() => conversation?.lastReadAt ?? new Date(0).toISOString());
  const [actionMessageId, setActionMessageId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const roots = useMemo(() => rootMessages(messages, conversationId), [messages, conversationId]);
  const isMember = Boolean(conversation?.memberIds.includes(meId));

  useEffect(() => {
    if (isMember) markRead(conversationId);
  }, [roots.length, isMember, conversationId, markRead]);

  if (!conversation) return null;

  const isChannel = conversation.kind === 'channel';
  const title = conversationTitle(conversation, users, meId);
  const others = conversation.memberIds.filter((id) => id !== meId);
  const dmPartner = !isChannel && others.length === 1 ? getUser(others[0]) : undefined;
  const subtitle = isChannel
    ? `${conversation.memberIds.length} members${conversation.topic ? ` · ${conversation.topic}` : ''}`
    : dmPartner
      ? [PRESENCE_LABEL[dmPartner.presence], dmPartner.title].filter(Boolean).join(' · ')
      : `${conversation.memberIds.length} people`;

  const firstUnreadId = roots.find((m) => m.authorId !== meId && m.kind !== 'system' && toMs(m.createdAt) > toMs(initialLastRead))?.id;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={tw`flex-1 bg-white`}>
      <NavHeader
        onBack={onBack}
        title={
          <View style={tw`flex-row items-center gap-1`}>
            {isChannel ? (
              conversation.isPrivate ? (
                <Lock size={14} color={colors.coolBlack} accessibilityLabel="Private" />
              ) : (
                <Hash size={15} color={colors.coolBlack} />
              )
            ) : null}
            <Text accessibilityRole="header" numberOfLines={1} style={tw`shrink text-base font-bold text-cool-black`}>
              {title}
            </Text>
          </View>
        }
        subtitle={subtitle}
        trailing={
          <IconButton label="Conversation details" onPress={onOpenDetails}>
            <Info size={20} color={colors.navy} />
          </IconButton>
        }
      />

      <ScrollView
        ref={scrollRef}
        style={tw`flex-1`}
        contentContainerStyle={tw`pb-3`}
        keyboardDismissMode="interactive"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
        <View style={tw`px-4 pb-2 pt-6`}>
          {isChannel ? (
            <View style={tw`h-12 w-12 items-center justify-center rounded-xl bg-pale-blue`}>
              {conversation.isPrivate ? <Lock size={22} color={colors.navy} /> : <Hash size={22} color={colors.navy} />}
            </View>
          ) : (
            <Avatar name={dmPartner?.name ?? title} size="md" />
          )}
          <Text style={tw`mt-3 font-heading text-lg text-cool-black`}>{isChannel ? `#${title}` : title}</Text>
          <Text style={tw`text-sm text-slate-500`}>
            {isChannel
              ? `This is the very beginning of #${title}.${conversation.topic ? ` ${conversation.topic}.` : ''}`
              : `This is the beginning of your conversation with ${title}.`}
          </Text>
        </View>

        {roots.map((m, i) => {
          const prev = roots[i - 1];
          const newDay = !prev || !isSameDay(new Date(prev.createdAt), new Date(m.createdAt));
          const isFirstUnread = m.id === firstUnreadId;
          const compact =
            !newDay &&
            !isFirstUnread &&
            !!prev &&
            prev.kind !== 'system' &&
            m.kind !== 'system' &&
            prev.authorId === m.authorId &&
            toMs(m.createdAt) - toMs(prev.createdAt) < 5 * 60 * 1000;
          const replies = threadReplies(messages, m.id);
          return (
            <React.Fragment key={m.id}>
              {newDay ? (
                <View style={tw`my-2 flex-row items-center gap-3 px-4`}>
                  <View style={tw`h-px flex-1 bg-slate-200`} />
                  <View style={tw`rounded-full border border-slate-200 px-2.5 py-0.5`}>
                    <Text style={tw`text-[11px] font-bold text-slate-500`}>{formatDayLabel(m.createdAt)}</Text>
                  </View>
                  <View style={tw`h-px flex-1 bg-slate-200`} />
                </View>
              ) : null}
              {isFirstUnread ? (
                <View accessibilityLabel="New messages" style={tw`my-1 flex-row items-center gap-2 px-4`}>
                  <View style={tw`h-px flex-1 bg-coral`} />
                  <Text style={tw`font-eyebrow text-[10px] uppercase tracking-widest text-coral`}>New</Text>
                </View>
              ) : null}
              <MessageItem
                message={m}
                compact={compact}
                replyCount={replies.length}
                lastReplyAt={replies[replies.length - 1]?.createdAt}
                replyAuthorIds={Array.from(new Set(replies.map((r) => r.authorId)))}
                onOpenThread={isMember ? () => onOpenThread(m.id) : undefined}
                onOpenActions={isMember ? () => setActionMessageId(m.id) : undefined}
              />
            </React.Fragment>
          );
        })}
      </ScrollView>

      {isMember ? (
        <Composer placeholder={`Message ${isChannel ? `#${title}` : title}`} onSend={(text) => sendMessage(conversationId, text)} />
      ) : (
        <View style={tw`border-t border-slate-200 bg-cool-white px-4 py-3`}>
          <Text style={tw`text-center text-sm text-dark-gray`}>
            You’re previewing <Text style={tw`font-bold`}>#{title}</Text>
          </Text>
          <View style={tw`mt-2`}>
            <Button fullWidth onPress={() => joinChannel(conversationId)}>
              Join channel
            </Button>
          </View>
        </View>
      )}

      <MessageActionsSheet
        messageId={actionMessageId}
        onClose={() => setActionMessageId(null)}
        onReply={(id) => {
          setActionMessageId(null);
          onOpenThread(id);
        }}
      />
    </KeyboardAvoidingView>
  );
}
