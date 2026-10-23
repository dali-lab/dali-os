import React from 'react';
import { View } from 'react-native';
import { addMinutes, format } from 'date-fns';
import { Minus, Plus } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import { IconButton } from './IconButton';
import { Text } from './Text';

export const STEP_MINUTES = 15;

/** A time of day, moved in 15-minute steps. */
export function TimeStepper({ label, value, onChange, disabled }: { label: string; value: Date; onChange: (d: Date) => void; disabled?: boolean }) {
  return (
    <View style={tw`flex-1`}>
      <Text style={tw`text-sm font-bold text-cool-black`}>{label}</Text>
      <View style={[tw`mt-1.5 h-11 flex-row items-center justify-between rounded-xl border border-slate-200 bg-white px-1`, disabled && tw`opacity-50`]}>
        <IconButton label={`${label} ${STEP_MINUTES} minutes earlier`} size="sm" disabled={disabled} onPress={() => onChange(addMinutes(value, -STEP_MINUTES))}>
          <Minus size={16} color={colors.navy} />
        </IconButton>
        <Text accessibilityLabel={`${label} ${format(value, 'h:mm a')}`} style={[tw`text-sm font-bold text-cool-black`, { fontVariant: ['tabular-nums'] }]}>
          {format(value, 'h:mm a')}
        </Text>
        <IconButton label={`${label} ${STEP_MINUTES} minutes later`} size="sm" disabled={disabled} onPress={() => onChange(addMinutes(value, STEP_MINUTES))}>
          <Plus size={16} color={colors.navy} />
        </IconButton>
      </View>
    </View>
  );
}
