import React, { useEffect, useRef } from 'react';
import { Alert, Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, Mic, Pause, Square, Trash2 } from 'lucide-react-native';
import { colors, shadow, tw } from '../../theme';
import { elapsedSeconds, useNotes } from '../../contexts/NotesContext';
import { useNow } from '../../hooks/useNow';
import { formatElapsed } from '../../utils/hours';
import { formatTimeRange } from '../../utils/time';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { ProcessingSteps } from './ProcessingSteps';

const BAR_SEEDS = Array.from({ length: 32 }, (_, i) => 0.25 + Math.abs(Math.sin(i * 12.9898) * 0.75));

function Blink({ children }: { children: React.ReactNode }) {
  const t = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 0.2, duration: 600, useNativeDriver: true }),
        Animated.timing(t, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  return <Animated.View style={{ opacity: t }}>{children}</Animated.View>;
}

export function RecorderScreen() {
  const insets = useSafeAreaInsets();
  const { active, inputLevel, pauseRecording, resumeRecording, finishRecording, discardRecording, hideRecorder } = useNotes();
  const isRecording = active?.phase === 'recording';
  const now = useNow(250, isRecording);
  if (!active) return null;

  const busy = active.phase === 'finishing' || active.phase === 'processing' || active.phase === 'writing';
  const failed = active.phase === 'failed';
  const elapsed = elapsedSeconds(active, now.getTime());
  const status = busy ? 'Processing' : failed ? 'Couldn’t process' : isRecording ? 'Recording' : 'Paused';

  const discard = () =>
    Alert.alert('Discard this recording?', 'The audio and transcript will be deleted.', [
      { text: 'Keep recording', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => void discardRecording() },
    ]);

  return (
    <View style={[tw`flex-1 bg-dark-navy`, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={tw`flex-row items-center gap-2 px-2 py-2`}>
        <Pressable accessibilityRole="button" accessibilityLabel="Minimize recorder" onPress={hideRecorder} style={tw`h-9 w-9 items-center justify-center rounded-full`}>
          <ChevronDown size={22} color={colors.white} />
        </Pressable>
        <View style={tw`flex-1 items-center`}>
          <Text numberOfLines={1} style={tw`text-sm font-bold text-white`}>
            {active.title}
          </Text>
          <Text numberOfLines={1} style={tw`text-[11px] text-white/60`}>
            {active.meeting ? formatTimeRange(active.meeting.start, active.meeting.end) : 'Quick recording'} · Phone mic
          </Text>
        </View>
        <View style={tw`w-9`} />
      </View>

      <View style={tw`items-center px-6 pt-4`}>
        <View style={[tw`flex-row items-center gap-1.5 rounded-full px-3 py-1`, busy || failed ? tw`bg-white/10` : isRecording ? tw`bg-coral` : tw`bg-yellow`]}>
          {isRecording ? (
            <Blink>
              <View style={tw`h-1.5 w-1.5 rounded-full bg-white`} />
            </Blink>
          ) : null}
          <Text style={[tw`font-eyebrow text-[11px] uppercase tracking-widest`, isRecording || busy || failed ? tw`text-white` : tw`text-dark-navy`]}>
            {status}
          </Text>
        </View>
        <Text accessibilityLabel={`Recorded ${formatElapsed(elapsed)}`} style={[tw`mt-3 font-heading text-5xl text-white`, { fontVariant: ['tabular-nums'] }]}>
          {formatElapsed(elapsed)}
        </Text>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={tw`mt-5 h-16 flex-row items-center gap-[3px]`}>
          {BAR_SEEDS.map((seed, i) => (
            <View
              key={i}
              style={[tw`w-1 rounded-full`, isRecording ? tw`bg-light-teal` : tw`bg-white/25`, { height: isRecording ? 6 + Math.min(1, inputLevel * 6) * seed * 52 : 6 }]}
            />
          ))}
        </View>
      </View>

      <View style={tw`mx-4 mt-5 flex-1 justify-center rounded-2xl bg-white/5 px-5`}>
        {busy ? (
          <ProcessingSteps phase={active.phase} />
        ) : failed ? (
          <Text style={tw`text-center text-sm text-pale-coral`}>{active.error ?? 'Transcription failed.'}</Text>
        ) : (
          <Text style={tw`text-center text-sm leading-5 text-white/60`}>
            Keep the phone near whoever is talking. The transcript and notes appear once you finish.
          </Text>
        )}
        {active.error && !failed ? <Text style={tw`mt-3 text-center text-xs text-pale-coral`}>{active.error}</Text> : null}
      </View>

      <View style={tw`px-6 pb-6 pt-5`}>
        {failed ? (
          <Button fullWidth variant="secondary" color="navy" onPress={() => void discardRecording()}>
            Close
          </Button>
        ) : busy ? (
          <Text style={tw`text-center text-[11px] text-white/50`}>You can minimize this. The notes open when they’re ready.</Text>
        ) : (
          <>
            <View style={tw`flex-row items-center justify-center gap-8`}>
              <Pressable accessibilityRole="button" accessibilityLabel="Discard recording" onPress={discard} style={tw`h-12 w-12 items-center justify-center rounded-full bg-white/10`}>
                <Trash2 size={18} color="rgba(255,255,255,0.8)" />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isRecording ? 'Pause recording' : 'Resume recording'}
                onPress={() => void (isRecording ? pauseRecording() : resumeRecording())}
                style={({ pressed }) => [tw`h-20 w-20 items-center justify-center rounded-full bg-white`, shadow.lg, pressed && { transform: [{ scale: 0.95 }] }]}>
                {isRecording ? <Pause size={30} color={colors.darkNavy} fill={colors.darkNavy} /> : <Mic size={30} color={colors.darkNavy} />}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Finish and write notes"
                onPress={() => void finishRecording()}
                style={tw`h-12 w-12 items-center justify-center rounded-full bg-coral`}>
                <Square size={16} color={colors.white} fill={colors.white} />
              </Pressable>
            </View>
            <Text style={tw`mt-3 text-center text-[11px] text-white/50`}>Tap ■ to finish · Audio is transcribed, then deleted</Text>
          </>
        )}
      </View>
    </View>
  );
}
