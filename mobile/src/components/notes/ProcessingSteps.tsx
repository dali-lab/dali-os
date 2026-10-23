import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { CheckCircle2, Circle } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import type { RecorderPhase } from '../../contexts/NotesContext';
import { Text } from '../ui/Text';

const STEPS = ['Uploading audio', 'Transcribing and labeling speakers', 'Writing your notes'];
const STEP_OF: Partial<Record<RecorderPhase, number>> = { finishing: 0, processing: 1, writing: 2 };

export function ProcessingSteps({ phase }: { phase: RecorderPhase }) {
  const step = STEP_OF[phase] ?? 0;
  return (
    <View accessibilityLiveRegion="polite" style={tw`gap-2.5 self-center`}>
      {STEPS.map((label, i) => (
        <View key={label} style={tw`flex-row items-center gap-3`}>
          {i < step ? (
            <CheckCircle2 size={18} color={colors.lightTeal} />
          ) : i === step ? (
            <ActivityIndicator size="small" color={colors.white} style={tw`h-[18px] w-[18px]`} />
          ) : (
            <Circle size={18} color="rgba(255,255,255,0.3)" />
          )}
          <Text style={[tw`text-sm`, i <= step ? tw`text-white` : tw`text-white/40`]}>{label}</Text>
        </View>
      ))}
    </View>
  );
}
