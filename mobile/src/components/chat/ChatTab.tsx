import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Dimensions, View } from 'react-native';
import { tw } from '../../theme';
import { useChat } from '../../contexts/ChatContext';
import type { ChatRoute } from '../../types/chat';
import { setActiveConversation, type ChatPushTarget } from '../../notifications/push';
import { BrowseChannelsSheet } from './BrowseChannelsSheet';
import { ChatHome } from './ChatHome';
import { ConversationDetails } from './ConversationDetails';
import { ConversationScreen } from './ConversationScreen';
import { CreateChannelSheet } from './CreateChannelSheet';
import { InviteSheet } from './InviteSheet';
import { NewMessageSheet } from './NewMessageSheet';
import { ThreadScreen } from './ThreadScreen';

type Sheet = 'browse' | 'create' | 'new' | null;

interface ChatTabProps {
  initialStack?: ChatRoute[];
  visible: boolean;
  request: ChatPushTarget | null;
  onRequestHandled: () => void;
  onOpenProfile: () => void;
}

function routeKey(route: ChatRoute): string {
  return route.name === 'thread' ? `thread-${route.messageId}` : `${route.name}-${route.id}`;
}

const SCREEN_W = Dimensions.get('window').width;

function SlideScreen({ leaving, onLeft, children }: { leaving: boolean; onLeft: () => void; children: React.ReactNode }) {
  const x = useRef(new Animated.Value(SCREEN_W)).current;

  useEffect(() => {
    Animated.spring(x, { toValue: 0, stiffness: 380, damping: 38, useNativeDriver: true }).start();
  }, [x]);

  useEffect(() => {
    if (!leaving) return;
    Animated.timing(x, { toValue: SCREEN_W, duration: 220, useNativeDriver: true }).start(({ finished }) => {
      if (finished) onLeft();
    });
  }, [leaving, onLeft, x]);

  return <Animated.View style={[tw`absolute inset-0 bg-white`, { transform: [{ translateX: x }] }]}>{children}</Animated.View>;
}

export function ChatTab({ initialStack = [], visible, request, onRequestHandled, onOpenProfile }: ChatTabProps) {
  const { conversations, meId, inviteMembers, openDirectMessage } = useChat();
  const [stack, setStack] = useState<ChatRoute[]>(initialStack);
  const [leavingIndex, setLeavingIndex] = useState<number | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [inviteFor, setInviteFor] = useState<string | null>(null);

  useEffect(() => {
    if (!request) return;
    const { conversationId, parentId } = request;
    setLeavingIndex(null);
    setStack([
      { name: 'conversation', id: conversationId },
      ...(parentId ? [{ name: 'thread' as const, conversationId, messageId: parentId }] : []),
    ]);
    onRequestHandled();
  }, [request, onRequestHandled]);

  const top = leavingIndex === stack.length - 1 ? stack[stack.length - 2] : stack[stack.length - 1];
  const viewingConversationId = !visible || !top ? null : top.name === 'thread' ? top.conversationId : top.name === 'conversation' ? top.id : null;

  useEffect(() => {
    setActiveConversation(viewingConversationId);
    return () => setActiveConversation(null);
  }, [viewingConversationId]);

  const push = (route: ChatRoute) => setStack((s) => [...s, route]);
  const pop = useCallback(() => {
    if (stack.length === 0) return false;
    setLeavingIndex(stack.length - 1);
    return true;
  }, [stack.length]);
  const finishPop = useCallback(() => {
    setStack((s) => s.slice(0, -1));
    setLeavingIndex(null);
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', pop);
    return () => sub.remove();
  }, [pop]);

  const openConversation = (id: string) => {
    setSheet(null);
    setInviteFor(null);
    setLeavingIndex(null);
    setStack([{ name: 'conversation', id }]);
  };

  const handleInvite = (conversationId: string, userIds: string[]) => {
    const conversation = conversations.find((c) => c.id === conversationId);
    if (!conversation) return;
    if (conversation.kind === 'channel') {
      inviteMembers(conversationId, userIds);
      setInviteFor(null);
    } else {
      const others = conversation.memberIds.filter((id) => id !== meId);
      openDirectMessage([...others, ...userIds]).then(openConversation, () => setInviteFor(null));
    }
  };

  const renderRoute = (route: ChatRoute) => {
    switch (route.name) {
      case 'conversation':
        return (
          <ConversationScreen
            conversationId={route.id}
            onBack={pop}
            onOpenThread={(messageId) => push({ name: 'thread', conversationId: route.id, messageId })}
            onOpenDetails={() => push({ name: 'details', id: route.id })}
          />
        );
      case 'thread':
        return <ThreadScreen conversationId={route.conversationId} messageId={route.messageId} onBack={pop} />;
      case 'details':
        return (
          <ConversationDetails
            conversationId={route.id}
            onBack={pop}
            onInvite={() => setInviteFor(route.id)}
            onLeft={() => {
              setLeavingIndex(null);
              setStack([]);
            }}
          />
        );
    }
  };

  return (
    <View style={tw`flex-1 overflow-hidden`}>
      <ChatHome
        onOpenConversation={openConversation}
        onBrowse={() => setSheet('browse')}
        onCreateChannel={() => setSheet('create')}
        onNewMessage={() => setSheet('new')}
        onOpenProfile={onOpenProfile}
      />
      {stack.map((route, index) => (
        <SlideScreen key={`${index}-${routeKey(route)}`} leaving={leavingIndex === index} onLeft={finishPop}>
          {renderRoute(route)}
        </SlideScreen>
      ))}

      <BrowseChannelsSheet open={sheet === 'browse'} onClose={() => setSheet(null)} onOpen={openConversation} onCreate={() => setSheet('create')} />
      <CreateChannelSheet open={sheet === 'create'} onClose={() => setSheet(null)} onCreated={openConversation} />
      <NewMessageSheet open={sheet === 'new'} onClose={() => setSheet(null)} onOpen={openConversation} />
      <InviteSheet conversationId={inviteFor} onClose={() => setInviteFor(null)} onConfirm={handleInvite} />
    </View>
  );
}
