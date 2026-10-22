import React from 'react';
import { ActivityIndicator, Pressable, View, type ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { colors, shadow, tw } from '../../theme';
import { Text } from './Text';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost';
type Color = 'teal' | 'navy' | 'coral';

const PALETTE: Record<Variant, Record<Color, { bg: string; fg: string; border?: string; pressed: string }>> = {
  primary: {
    teal: { bg: colors.teal, fg: colors.white, pressed: '#1F9C9C' },
    navy: { bg: colors.navy, fg: colors.white, pressed: colors.darkNavy },
    coral: { bg: colors.coral, fg: colors.white, pressed: colors.darkCoral },
  },
  secondary: {
    teal: { bg: colors.paleTeal, fg: colors.coolBlack, pressed: colors.lightTeal },
    navy: { bg: colors.paleBlue, fg: colors.navy, pressed: '#C2E2F8' },
    coral: { bg: colors.paleCoral, fg: colors.coolBlack, pressed: colors.lightCoral },
  },
  outline: {
    teal: { bg: 'transparent', fg: colors.teal, border: colors.teal, pressed: '#E6F7F7' },
    navy: { bg: 'transparent', fg: colors.navy, border: colors.navy, pressed: colors.paleBlue },
    coral: { bg: 'transparent', fg: colors.coral, border: colors.coral, pressed: '#FDECEE' },
  },
  ghost: {
    teal: { bg: 'transparent', fg: colors.teal, pressed: colors.coolWhite },
    navy: { bg: 'transparent', fg: colors.navy, pressed: colors.paleBlue },
    coral: { bg: 'transparent', fg: colors.coral, pressed: colors.coolWhite },
  },
};

const SIZES = {
  sm: { h: 32, px: 12, text: 14, icon: 14, gap: 6 },
  md: { h: 40, px: 20, text: 14, icon: 16, gap: 8 },
  lg: { h: 48, px: 24, text: 16, icon: 20, gap: 8 },
};

interface ButtonProps {
  children?: React.ReactNode;
  onPress?: () => void;
  variant?: Variant;
  color?: Color;
  size?: keyof typeof SIZES;
  shape?: 'pill' | 'rounded';
  leftIcon?: LucideIcon;
  rightIcon?: LucideIcon;
  fullWidth?: boolean;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export function Button({
  children,
  onPress,
  variant = 'primary',
  color = 'teal',
  size = 'md',
  shape = 'pill',
  leftIcon: Left,
  rightIcon: Right,
  fullWidth,
  disabled,
  loading,
  style,
}: ButtonProps) {
  const p = PALETTE[variant][color];
  const s = SIZES[size];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        tw`flex-row items-center justify-center`,
        { height: s.h, paddingHorizontal: s.px, gap: s.gap, backgroundColor: pressed ? p.pressed : p.bg },
        p.border ? { borderWidth: 1, borderColor: p.border } : null,
        variant === 'primary' && !inactive ? shadow.sm : null,
        shape === 'pill' ? tw`rounded-full` : tw`rounded-lg`,
        fullWidth ? tw`w-full` : tw`self-start`,
        inactive ? tw`opacity-50` : null,
        style,
      ]}>
      {loading ? <ActivityIndicator size="small" color={p.fg} /> : Left ? <Left size={s.icon} color={p.fg} /> : null}
      {children != null && <Text style={{ color: p.fg, fontSize: s.text, fontWeight: '600' }}>{children}</Text>}
      {!loading && Right ? <View><Right size={s.icon} color={p.fg} /></View> : null}
    </Pressable>
  );
}
