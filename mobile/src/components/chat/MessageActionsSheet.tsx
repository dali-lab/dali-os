import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Check, Copy, MessageSquareReply, type LucideIcon } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import { useChat } from '../../contexts/ChatContext';
import { BottomSheet } from '../ui/BottomSheet';
import { Eyebrow } from '../ui/Eyebrow';
import { Text } from '../ui/Text';

const EMOJI = ['👍', '❤️', '😂', '🎉', '🙏', '🔥', '👀', '🙌', '✅', '💯', '🚀', '😊', '😍', '🤔', '😮', '😢', '👏', '🍕', '☕', '✨', '💡', '🙋', '👋', '🫡'];

interface MessageActionsSheetProps {
  messageId: string | null;
  onClose: () => void;
  onReply?: (messageId: string) => void;
}

function Action({ icon: I, iconColor = colors.navy, label, onPress }: { icon: LucideIcon; iconColor?: string; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [tw`flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5`, pressed && tw`bg-slate-50`]}>
      <I size={16} color={iconColor} />
      <Text style={tw`text-sm font-bold text-navy`}>{label}</Text>
    </Pressable>
  );
}

export function MessageActionsSheet({ messageId, onClose, onReply }: MessageActionsSheetProps) {
  const { messages, getUser, toggleReaction } = useChat();
  const [copied, setCopied] = useState(false);
  const message = messages.find((m) => m.id === messageId);

  useEffect(() => {
    if (!messageId) setCopied(false);
  }, [messageId]);

  const copy = () => {
    if (message) Clipboard.setStringAsync(message.text);
    setCopied(true);
    setTimeout(onClose, 700);
  };

  return (
    <BottomSheet open={Boolean(message)} onClose={onClose} title="Message">
      {message ? (
        <>
          <View style={tw`rounded-xl bg-cool-white px-3 py-2.5`}>
            <Text style={tw`text-xs font-bold text-slate-500`}>{getUser(message.authorId)?.name}</Text>
            <Text numberOfLines={2} style={tw`mt-0.5 text-sm text-dark-gray`}>
              {message.text}
            </Text>
          </View>

          <View style={tw`mt-3 flex-row gap-2`}>
            {onReply ? <Action icon={MessageSquareReply} label="Reply in thread" onPress={() => onReply(message.id)} /> : null}
            <Action icon={copied ? Check : Copy} iconColor={copied ? colors.teal : colors.navy} label={copied ? 'Copied' : 'Copy text'} onPress={copy} />
          </View>

          <Eyebrow style={tw`mb-2 mt-4`}>Add reaction</Eyebrow>
          <View style={tw`flex-row flex-wrap`}>
            {EMOJI.map((emoji) => (
              <Pressable
                key={emoji}
                accessibilityRole="button"
                accessibilityLabel={`React with ${emoji}`}
                onPress={() => {
                  toggleReaction(message.id, emoji);
                  onClose();
                }}
                style={({ pressed }) => [tw`items-center justify-center rounded-xl py-2`, { width: '16.66%' }, pressed && tw`bg-slate-100`]}>
                <Text style={tw`text-2xl`}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </BottomSheet>
  );
}
