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
import { DataProvider, useData } from './contexts/DataContext';
import { NotesProvider, useNotes, type MeetingTarget } from './contexts/NotesContext';
import { api, errorMessage } from './api/client';
import { TimeProvider, useTime } from './contexts/TimeContext';
import type { TabId } from './types/navigation';
import { CalendarTab } from './components/calendar/CalendarTab';
import { NotesTab } from './components/notes/NotesTab';
import { LandingScreen } from './components/onboarding/LandingScreen';
import { SyncingScreen } from './components/onboarding/SyncingScreen';
import { PassTab } from './components/pass/PassTab';
import { ProfileSheet } from './components/ProfileSheet';
import { ProjectTab } from './components/project/ProjectTab';
import { TabBar } from './components/TabBar';
import { TimeTab } from './components/time/TimeTab';

ExpoSplash.preventAutoHideAsync();

type Stage = 'landing' | 'syncing' | 'app';

export default function App() {
  const [fontsLoaded] = useFonts({ Inter_700Bold, PTSans_400Regular, PTSans_700Bold, DMMono_400Regular, DMMono_500Medium });

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <DataProvider>
          <TimeProvider>
            <NotesProvider>
              <Shell />
            </NotesProvider>
          </TimeProvider>
        </DataProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  const auth = useAuth();
  const { reset } = useData();
  const time = useTime();
  const notes = useNotes();
  const [synced, setSynced] = useState(false);
  const [tab, setTab] = useState<TabId>('time');
  const [profileOpen, setProfileOpen] = useState(false);
  const resetAll = useRef(() => {});
  resetAll.current = () => {
    reset();
    time.reset();
    notes.reset();
  };

  useEffect(() => {
    if (auth.status !== 'loading') ExpoSplash.hideAsync();
    if (auth.status !== 'signedIn') {
      setSynced(false);
      setProfileOpen(false);
      setTab('time');
    }
    // Not while still loading: that would drop a running timer saved on the device.
    if (auth.status === 'signedOut') resetAll.current();
  }, [auth.status]);

  const stage: Stage | null =
    auth.status === 'loading' ? null : auth.status !== 'signedIn' ? 'landing' : synced ? 'app' : 'syncing';

  const openProfile = useCallback(() => setProfileOpen(true), []);
  const toApp = useCallback(() => setSynced(true), []);
  const startProjectTimer = (note?: string) => {
    if (!time.timer) time.startTimer(undefined, note ?? '');
    setTab('time');
  };
  const recordMeeting = async (meeting: MeetingTarget) => {
    const message = await notes.startRecording({ kind: 'meeting', meeting });
    if (!message) setTab('notes');
    return message;
  };
  const takeNotes = async (meeting: MeetingTarget) => {
    try {
      const page = await api.meetingNotePage(meeting.id, meeting.occurrenceStart);
      notes.openEditor({ pageId: page.pageId, title: meeting.title });
      setTab('notes');
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  };
  const viewNote = (recordingId: string) => {
    notes.openNote(recordingId);
    setTab('notes');
  };
  const signOut = () => {
    setProfileOpen(false);
    void auth.signOut();
  };

  const panel = (id: TabId) => [tw`absolute inset-0`, tab !== id && { display: 'none' as const }];

  return (
    <View style={tw`flex-1 bg-dark-navy`}>
      <StatusBar style={stage === 'app' && !(tab === 'notes' && notes.active && notes.recorderVisible) ? 'dark' : 'light'} />
      {stage === 'app' ? (
        <View style={tw`flex-1 bg-cool-white`}>
          <View style={tw`flex-1`}>
            <View style={panel('time')}>
              <TimeTab onOpenProfile={openProfile} />
            </View>
            <View style={panel('project')}>
              <ProjectTab onStartTimer={startProjectTimer} onOpenProfile={openProfile} />
            </View>
            <View style={panel('calendar')}>
              <CalendarTab onOpenProfile={openProfile} onRecordMeeting={recordMeeting} onTakeNotes={takeNotes} onViewNote={viewNote} />
            </View>
            <View style={panel('notes')}>
              <NotesTab onOpenProfile={openProfile} />
            </View>
            <View style={panel('pass')}>
              <PassTab onOpenProfile={openProfile} />
            </View>
          </View>
          <TabBar active={tab} onChange={setTab} />
          <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} onSignOut={signOut} />
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

function FadeIn({ children }: { children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, [opacity]);
  return <Animated.View style={[tw`absolute inset-0 bg-dark-navy`, { opacity }]}>{children}</Animated.View>;
}
