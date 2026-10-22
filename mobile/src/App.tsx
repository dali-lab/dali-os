import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as ExpoSplash from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Inter_700Bold } from '@expo-google-fonts/inter';
import { PTSans_400Regular, PTSans_700Bold } from '@expo-google-fonts/pt-sans';
import { DMMono_400Regular, DMMono_500Medium } from '@expo-google-fonts/dm-mono';
import { tw } from './theme';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ChatProvider, useChat } from './contexts/ChatContext';
import { DataProvider, useData } from './contexts/DataContext';
import type { TabId } from './types/navigation';
import { CalendarTab } from './components/calendar/CalendarTab';
import { ChatTab } from './components/chat/ChatTab';
import { LandingScreen } from './components/onboarding/LandingScreen';
import { SyncingScreen } from './components/onboarding/SyncingScreen';
import { PassTab } from './components/pass/PassTab';
import { ProfileSheet } from './components/ProfileSheet';
import { ProjectTab } from './components/project/ProjectTab';
import { TabBar } from './components/TabBar';
import * as Notifications from 'expo-notifications';
import { chatTargetFrom, registerForPush, setUnreadBadge, type ChatPushTarget } from './notifications/push';
import { unreadCount } from './utils/chat';

ExpoSplash.preventAutoHideAsync();

type Stage = 'landing' | 'syncing' | 'app';

export default function App() {
  const [fontsLoaded] = useFonts({ Inter_700Bold, PTSans_400Regular, PTSans_700Bold, DMMono_400Regular, DMMono_500Medium });

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <DataProvider>
          <ChatBridge>
            <Shell />
          </ChatBridge>
        </DataProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function ChatBridge({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const { setMyPresence } = useData();
  return (
    <ChatProvider enabled={status === 'signedIn'} onPresenceChange={setMyPresence}>
      {children}
    </ChatProvider>
  );
}

function Shell() {
  const auth = useAuth();
  const { reset } = useData();
  const [synced, setSynced] = useState(false);
  const [tab, setTab] = useState<TabId>('chat');
  const [profileOpen, setProfileOpen] = useState(false);
  const [chatTarget, setChatTarget] = useState<ChatPushTarget | null>(null);

  useEffect(() => {
    if (auth.status !== 'loading') ExpoSplash.hideAsync();
    if (auth.status !== 'signedIn') {
      setSynced(false);
      setProfileOpen(false);
      setTab('chat');
      reset();
    }
  }, [auth.status, reset]);

  const stage: Stage | null =
    auth.status === 'loading' ? null : auth.status !== 'signedIn' ? 'landing' : synced ? 'app' : 'syncing';

  const openProfile = useCallback(() => setProfileOpen(true), []);
  const clearChatTarget = useCallback(() => setChatTarget(null), []);
  const toApp = useCallback(() => setSynced(true), []);
  const openChat = useCallback((target: ChatPushTarget) => {
    setChatTarget(target);
    setTab('chat');
  }, []);
  const openChannel = (conversationId: string) => openChat({ conversationId, parentId: null });
  const signOut = () => {
    setProfileOpen(false);
    void auth.signOut();
  };

  const panel = (id: TabId) => [tw`absolute inset-0`, tab !== id && { display: 'none' as const }];

  return (
    <View style={tw`flex-1 bg-dark-navy`}>
      <StatusBar style={stage === 'app' ? 'dark' : 'light'} />
      {stage === 'app' ? (
        <View style={tw`flex-1 bg-cool-white`}>
          <View style={tw`flex-1`}>
            <View style={panel('chat')}>
              <ChatTab visible={tab === 'chat'} request={chatTarget} onRequestHandled={clearChatTarget} onOpenProfile={openProfile} />
            </View>
            <View style={panel('project')}>
              <ProjectTab onOpenChannel={openChannel} onOpenProfile={openProfile} />
            </View>
            <View style={panel('calendar')}>
              <CalendarTab onOpenProfile={openProfile} />
            </View>
            <View style={panel('pass')}>
              <PassTab onOpenProfile={openProfile} />
            </View>
          </View>
          <TabBar active={tab} onChange={setTab} />
          <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} onSignOut={signOut} />
          <PushBridge onOpenChat={openChat} />
        </View>
      ) : null}

      {stage === 'landing' || stage === 'syncing' ? (
        <FadeIn key={stage}>
          {stage === 'landing' ? <LandingScreen /> : <SyncingScreen onDone={toApp} />}
        </FadeIn>
      ) : null}
    </View>
  );
}

function PushBridge({ onOpenChat }: { onOpenChat: (target: ChatPushTarget) => void }) {
  const { conversations, messages, meId } = useChat();
  const handled = useRef<string | null>(null);
  const unread = meId ? conversations.reduce((sum, c) => sum + unreadCount(c, messages, meId), 0) : 0;

  useEffect(() => {
    void registerForPush();
  }, []);

  useEffect(() => {
    setUnreadBadge(unread);
  }, [unread]);

  useEffect(() => {
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response || handled.current === response.notification.request.identifier) return;
      handled.current = response.notification.request.identifier;
      const target = chatTargetFrom(response.notification.request.content.data);
      if (target) onOpenChat(target);
    };
    void Notifications.getLastNotificationResponseAsync().then(open);
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [onOpenChat]);

  return null;
}

function FadeIn({ children }: { children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, [opacity]);
  return <Animated.View style={[tw`absolute inset-0 bg-dark-navy`, { opacity }]}>{children}</Animated.View>;
}
