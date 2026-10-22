import React from 'react';
import { View } from 'react-native';
import { tw } from '../../theme';
import { Text } from './Text';

const SIZES = {
  xs: { box: 24, text: 10 },
  sm: { box: 32, text: 12 },
  md: { box: 48, text: 14 },
  lg: { box: 64, text: 18 },
  xl: { box: 96, text: 24 },
};

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function Avatar({ name, size = 'md', ring = false }: { name: string; size?: keyof typeof SIZES; ring?: boolean }) {
  const s = SIZES[size];
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={name}
      style={[
        tw`items-center justify-center rounded-full bg-[#E5E5E5]`,
        ring ? { width: s.box + 4, height: s.box + 4, borderWidth: 2, borderColor: 'white' } : { width: s.box, height: s.box },
      ]}>
      <Text style={[tw`font-bold text-[#404040]`, { fontSize: s.text }]}>{initials(name)}</Text>
    </View>
  );
}
