import React from 'react';
import { Pressable, type ViewStyle } from 'react-native';
import { tw } from '../../theme';

interface IconButtonProps {
  label: string;
  onPress?: () => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
  style?: ViewStyle;
  children: React.ReactNode;
}

export function IconButton({ label, onPress, size = 'md', disabled, style, children }: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        tw`items-center justify-center rounded-full`,
        size === 'sm' ? tw`h-7 w-7` : tw`h-9 w-9`,
        pressed && tw`bg-slate-100`,
        disabled && tw`opacity-40`,
        style,
      ]}>
      {children}
    </Pressable>
  );
}
