import React from 'react';
import { View } from 'react-native';
import { tw } from '../../theme';
import { Text } from './Text';

export type TagTone = 'neutral' | 'blue' | 'green' | 'amber' | 'rose' | 'violet';

const TONES: Record<TagTone, { bg: string; fg: string }> = {
  neutral: { bg: '#F1F5F9', fg: '#334155' },
  blue: { bg: '#EFF6FF', fg: '#1D4ED8' },
  green: { bg: '#ECFDF5', fg: '#047857' },
  amber: { bg: '#FFFBEB', fg: '#92400E' },
  rose: { bg: '#FFF1F2', fg: '#BE123C' },
  violet: { bg: '#F5F3FF', fg: '#6D28D9' },
};

export function Tag({ tone = 'neutral', size = 'md', icon, children }: { tone?: TagTone; size?: 'sm' | 'md'; icon?: React.ReactNode; children: React.ReactNode }) {
  const t = TONES[tone];
  return (
    <View
      style={[
        tw`flex-row items-center self-start rounded-full`,
        size === 'sm' ? tw`h-5 px-2 gap-1` : tw`h-6 px-2.5 gap-1.5`,
        { backgroundColor: t.bg },
      ]}>
      {icon}
      <Text numberOfLines={1} style={[{ color: t.fg, fontWeight: '500' }, size === 'sm' ? tw`text-[11px]` : tw`text-xs`]}>
        {children}
      </Text>
    </View>
  );
}
