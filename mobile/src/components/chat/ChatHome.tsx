import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { ChevronDown, Compass, Plus, SquarePen } from 'lucide-react-native';
import { colors, shadow, tw } from '../../theme';
import { useChat } from '../../contexts/ChatContext';
import { conversationTitle, lastRootMessage, unreadCount } from '../../utils/chat';
import { toMs } from '../../utils/time';
import { TopBar } from '../TopBar';
import { Eyebrow } from '../ui/Eyebrow';
import { IconButton } from '../ui/IconButton';
import { Text } from '../ui/Text';
import { ErrorState, LoadingState } from '../ui/StateViews';
import { TextField } from '../ui/TextField';
import { ConversationRow } from './ConversationRow';

type Filter = 'all' | 'dms' | 'channels';

interface ChatHomeProps {
  onOpenConversation: (id: string) => void;
  onBrowse: () => void;
  onCreateChannel: () => void;
  onNewMessage: () => void;
  onOpenProfile: () => void;
}

export function ChatHome({ onOpenConversation, onBrowse, onCreateChannel, onNewMessage, onOpenProfile }: ChatHomeProps) {
  const { conversations, messages, users, meId, loading, error, refresh } = useChat();
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [channelsOpen, setChannelsOpen] = useState(true);
  const q = query.trim().toLowerCase();

  const items = conversations
    .filter((c) => c.memberIds.includes(meId))
    .map((c) => ({
      conversation: c,
      title: conversationTitle(c, users, meId),
      unread: unreadCount(c, messages, meId),
      last: lastRootMessage(messages, c.id),
    }))
    .filter((i) => !q || i.title.toLowerCase().includes(q));

  const activity = (i: (typeof items)[number]) => (i.last ? toMs(i.last.createdAt) : toMs(i.conversation.createdAt));

  // Unread channels float to the top so they're never lost in a long list
  const channels = items
    .filter((i) => i.conversation.kind === 'channel')
    .sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0) || a.title.localeCompare(b.title));
  const dms = items.filter((i) => i.conversation.kind === 'dm').sort((a, b) => activity(b) - activity(a));

  const dmUnread = dms.reduce((s, i) => s + i.unread, 0);
  const channelUnread = channels.reduce((s, i) => s + i.unread, 0);

  const showDms = filter !== 'channels';
  const showChannels = filter !== 'dms';
  // In "All", collapsing channels still keeps unread ones visible
  const visibleChannels = filter === 'all' && !channelsOpen && !q ? channels.filter((i) => i.unread > 0) : channels;

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: 0 },
    { id: 'dms', label: 'DMs', count: dmUnread },
    { id: 'channels', label: 'Channels', count: channelUnread },
  ];

  const utilityRow = ({ pressed }: { pressed: boolean }) => [tw`w-full flex-row items-center gap-3 px-4 py-2`, pressed && tw`bg-slate-100`];

  return (
    <View style={tw`flex-1 bg-cool-white`}>
      <TopBar
        title="Messages"
        onOpenProfile={onOpenProfile}
        actions={
          <IconButton label="New message" onPress={onNewMessage}>
            <SquarePen size={20} color={colors.navy} />
          </IconButton>
        }
      />
      <View style={tw`border-b border-slate-200 bg-white px-4 pb-3 pt-3`}>
        <TextField
          variant="search"
          size="sm"
          accessibilityLabel="Search conversations"
          placeholder="Jump to a channel or person…"
          value={query}
          onChangeText={setQuery}
        />
        <View accessibilityRole="tablist" style={tw`mt-3 flex-row gap-1 rounded-xl bg-slate-100 p-1`}>
          {filters.map((f) => {
            const active = filter === f.id;
            return (
              <Pressable
                key={f.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={f.count > 0 ? `${f.label}, ${f.count} unread` : f.label}
                onPress={() => setFilter(f.id)}
                style={[tw`flex-1 flex-row items-center justify-center gap-1.5 rounded-lg py-1.5`, active && tw`bg-white`, active && shadow.sm]}>
                <Text style={[tw`text-sm`, active ? tw`font-bold text-navy` : tw`text-slate-500`]}>{f.label}</Text>
                {f.count > 0 ? (
                  <View style={tw`h-4 min-w-4 items-center justify-center rounded-full bg-coral px-1`}>
                    <Text style={tw`text-[10px] font-bold text-white`}>{f.count}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView
        style={tw`flex-1`}
        contentContainerStyle={tw`pb-6`}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await refresh();
              setRefreshing(false);
            }}
            tintColor={colors.teal}
            colors={[colors.teal]}
          />
        }>
        {!meId && loading ? <LoadingState /> : null}
        {!meId && !loading && error ? <ErrorState message={error} onRetry={() => void refresh()} /> : null}
        {showChannels ? (
          <View style={tw`mt-3`}>
            <View style={tw`flex-row items-center justify-between px-4 pb-1`}>
              {filter === 'all' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: channelsOpen }}
                  onPress={() => setChannelsOpen((v) => !v)}
                  style={tw`flex-row items-center gap-1`}>
                  <View style={{ transform: [{ rotate: channelsOpen ? '0deg' : '-90deg' }] }}>
                    <ChevronDown size={14} color={colors.slate500} />
                  </View>
                  <Eyebrow>Channels · {channels.length}</Eyebrow>
                </Pressable>
              ) : (
                <Eyebrow>Channels · {channels.length}</Eyebrow>
              )}
              <IconButton label="Create channel" size="sm" onPress={onCreateChannel}>
                <Plus size={16} color={colors.navy} />
              </IconButton>
            </View>
            {visibleChannels.map((i) => (
              <ConversationRow
                key={i.conversation.id}
                conversation={i.conversation}
                title={i.title}
                unread={i.unread}
                onPress={() => onOpenConversation(i.conversation.id)}
              />
            ))}
            {!q && (channelsOpen || filter === 'channels') ? (
              <Pressable accessibilityRole="button" onPress={onBrowse} style={utilityRow}>
                <View style={[tw`h-8 w-8 items-center justify-center rounded-lg border border-medium-gray`, { borderStyle: 'dashed' }]}>
                  <Compass size={15} color={colors.slate500} />
                </View>
                <Text style={tw`text-[15px] text-slate-500`}>Browse all channels</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {showDms ? (
          <View style={tw`mt-4`}>
            <View style={tw`flex-row items-center justify-between px-4 pb-1`}>
              <Eyebrow>Direct messages</Eyebrow>
              <IconButton label="New direct message" size="sm" onPress={onNewMessage}>
                <Plus size={16} color={colors.navy} />
              </IconButton>
            </View>
            {dms.map((i) => (
              <ConversationRow
                key={i.conversation.id}
                conversation={i.conversation}
                title={i.title}
                unread={i.unread}
                lastMessage={i.last}
                onPress={() => onOpenConversation(i.conversation.id)}
              />
            ))}
            {dms.length === 0 && !q ? (
              <Pressable accessibilityRole="button" onPress={onNewMessage} style={utilityRow}>
                <Text style={tw`text-[15px] text-slate-500`}>Start a conversation</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {q && (showChannels ? channels.length : 0) + (showDms ? dms.length : 0) === 0 ? (
          <Text style={tw`px-6 py-10 text-center text-sm text-slate-500`}>No conversations match “{query}”.</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
