import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Check, Hash, Lock } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import { useChat } from '../../contexts/ChatContext';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { TextField } from '../ui/TextField';

interface BrowseChannelsSheetProps {
  open: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
  onCreate: () => void;
}

export function BrowseChannelsSheet({ open, onClose, onOpen, onCreate }: BrowseChannelsSheetProps) {
  const { conversations, meId, joinChannel } = useChat();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const channels = conversations
    .filter((c) => c.kind === 'channel' && (!c.isPrivate || c.memberIds.includes(meId)))
    .filter((c) => !q || (c.name ?? '').includes(q) || (c.topic ?? '').toLowerCase().includes(q))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Browse channels"
      description="Public channels anyone at DALI can join"
      footer={
        <Button variant="secondary" fullWidth onPress={onCreate}>
          Create a new channel
        </Button>
      }>
      <TextField variant="search" size="sm" accessibilityLabel="Search channels" placeholder="Search channels" value={query} onChangeText={setQuery} autoCapitalize="none" />
      <View style={tw`mt-3`}>
        {channels.map((c, i) => {
          const joined = c.memberIds.includes(meId);
          return (
            <View key={c.id} style={[tw`flex-row items-center gap-3 py-2.5`, i > 0 && tw`border-t border-slate-100`]}>
              <Pressable accessibilityRole="button" onPress={() => onOpen(c.id)} style={tw`flex-1 flex-row items-center gap-3`}>
                <View style={tw`h-9 w-9 items-center justify-center rounded-lg bg-pale-blue`}>
                  {c.isPrivate ? <Lock size={16} color={colors.navy} /> : <Hash size={16} color={colors.navy} />}
                </View>
                <View style={tw`flex-1`}>
                  <Text numberOfLines={1} style={tw`text-sm font-bold text-cool-black`}>
                    {c.name}
                  </Text>
                  <Text numberOfLines={1} style={tw`text-xs text-slate-500`}>
                    {c.memberIds.length} members{c.topic ? ` · ${c.topic}` : ''}
                  </Text>
                </View>
              </Pressable>
              {joined ? (
                <View style={tw`flex-row items-center gap-1`}>
                  <Check size={14} color={colors.teal} />
                  <Text style={tw`text-xs font-bold text-teal`}>Joined</Text>
                </View>
              ) : (
                <Button size="sm" variant="outline" onPress={() => joinChannel(c.id)}>
                  Join
                </Button>
              )}
            </View>
          );
        })}
        {channels.length === 0 ? <Text style={tw`py-8 text-center text-sm text-slate-500`}>No channels match “{query}”.</Text> : null}
      </View>
    </BottomSheet>
  );
}
