import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { tw } from '../../theme';
import { useChat } from '../../contexts/ChatContext';
import { conversationTitle, threadReplies } from '../../utils/chat';
import { toMs } from '../../utils/time';
import { NavHeader } from '../NavHeader';
import { Text } from '../ui/Text';
import { Composer } from './Composer';
import { MessageActionsSheet } from './MessageActionsSheet';
import { MessageItem } from './MessageItem';

interface ThreadScreenProps {
  conversationId: string;
  messageId: string;
  onBack: () => void;
}

export function ThreadScreen({ conversationId, messageId, onBack }: ThreadScreenProps) {
  const { conversations, messages, users, meId, sendMessage } = useChat();
  const conversation = conversations.find((c) => c.id === conversationId);
  const parent = messages.find((m) => m.id === messageId);
  const replies = threadReplies(messages, messageId);
  const scrollRef = useRef<ScrollView>(null);
  const [actionMessageId, setActionMessageId] = useState<string | null>(null);

  if (!conversation || !parent) return null;
  const title = conversationTitle(conversation, users, meId);
  const isMember = conversation.memberIds.includes(meId);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={tw`flex-1 bg-white`}>
      <NavHeader onBack={onBack} title="Thread" subtitle={`in ${conversation.kind === 'channel' ? '#' : ''}${title}`} />
      <ScrollView
        ref={scrollRef}
        style={tw`flex-1`}
        contentContainerStyle={tw`pb-3 pt-1`}
        keyboardDismissMode="interactive"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
        <MessageItem message={parent} onOpenActions={isMember ? () => setActionMessageId(parent.id) : undefined} />
        <View style={tw`my-2 flex-row items-center gap-3 px-4`}>
          <Text style={tw`text-xs font-bold text-slate-500`}>
            {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
          </Text>
          <View style={tw`h-px flex-1 bg-slate-200`} />
        </View>
        {replies.map((r, i) => {
          const prev = replies[i - 1];
          const compact = !!prev && prev.authorId === r.authorId && toMs(r.createdAt) - toMs(prev.createdAt) < 5 * 60 * 1000;
          return (
            <MessageItem key={r.id} message={r} compact={compact} onOpenActions={isMember ? () => setActionMessageId(r.id) : undefined} />
          );
        })}
        {replies.length === 0 ? <Text style={tw`px-4 py-6 text-center text-sm text-slate-500`}>No replies yet. Start the thread.</Text> : null}
      </ScrollView>
      {isMember ? <Composer placeholder="Reply in thread…" onSend={(text) => sendMessage(conversationId, text, messageId)} /> : null}
      <MessageActionsSheet messageId={actionMessageId} onClose={() => setActionMessageId(null)} />
    </KeyboardAvoidingView>
  );
}
