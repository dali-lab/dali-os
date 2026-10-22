import React from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { colors } from '../../theme';

export type { LucideIcon };

export function Icon({ icon: I, size = 20, color = colors.navy, strokeWidth = 2 }: { icon: LucideIcon; size?: number; color?: string; strokeWidth?: number }) {
  return <I size={size} color={color} strokeWidth={strokeWidth} />;
}
