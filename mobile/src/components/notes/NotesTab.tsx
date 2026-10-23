import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, View } from 'react-native';
import { tw } from '../../theme';
import { useNotes } from '../../contexts/NotesContext';
import { Toast } from '../ui/Toast';
import { NoteDetailScreen } from './NoteDetailScreen';
import { NoteEditorScreen } from './NoteEditorScreen';
import { NotesHome } from './NotesHome';
import { RecorderScreen } from './RecorderScreen';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

/** Keeps `children` mounted while it slides out, then unmounts it. */
function Slide({ shown, from, children }: { shown: boolean; from: 'right' | 'bottom'; children: React.ReactNode }) {
  const t = useRef(new Animated.Value(shown ? 1 : 0)).current;
  const [mounted, setMounted] = useState(shown);
  useEffect(() => {
    if (shown) setMounted(true);
    Animated.spring(t, { toValue: shown ? 1 : 0, damping: 38, stiffness: 380, useNativeDriver: true }).start(({ finished }) => {
      if (finished && !shown) setMounted(false);
    });
  }, [shown, t]);
  if (!mounted) return null;
  const offset = t.interpolate({ inputRange: [0, 1], outputRange: [from === 'right' ? SCREEN_W : SCREEN_H, 0] });
  return (
    <Animated.View style={[tw`absolute inset-0`, { transform: from === 'right' ? [{ translateX: offset }] : [{ translateY: offset }] }]}>
      {children}
    </Animated.View>
  );
}

export function NotesTab({ onOpenProfile }: { onOpenProfile: () => void }) {
  const { notes, error, load, active, recorderVisible, viewingId, closeNote, editing, closeEditor, notice, clearNotice } = useNotes();
  const [message, setMessage] = useState<string | null>(null);
  const lastViewed = useRef(viewingId);
  if (viewingId) lastViewed.current = viewingId;
  const lastEditing = useRef(editing);
  if (editing) lastEditing.current = editing;

  useEffect(() => {
    if (!notes && !error) void load();
  }, [notes, error, load]);

  return (
    <View style={tw`flex-1`}>
      <NotesHome onOpenProfile={onOpenProfile} onError={setMessage} />
      <Slide shown={Boolean(viewingId)} from="right">
        {lastViewed.current ? <NoteDetailScreen recordingId={lastViewed.current} onBack={closeNote} /> : null}
      </Slide>
      <Slide shown={Boolean(editing)} from="right">
        {lastEditing.current ? (
          <NoteEditorScreen key={lastEditing.current.pageId} pageId={lastEditing.current.pageId} title={lastEditing.current.title} onBack={closeEditor} />
        ) : null}
      </Slide>
      <Slide shown={Boolean(active) && recorderVisible} from="bottom">
        <RecorderScreen />
      </Slide>
      <Toast message={message ?? notice} onDismiss={() => (message ? setMessage(null) : clearNotice())} />
    </View>
  );
}
