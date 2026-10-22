import React from 'react';
import type { TextStyle } from 'react-native';
import { tw } from '../../theme';
import { Text } from './Text';

export function Eyebrow({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[tw`font-eyebrow text-[11px] uppercase tracking-widest text-slate-500`, style]}>{children}</Text>;
}
