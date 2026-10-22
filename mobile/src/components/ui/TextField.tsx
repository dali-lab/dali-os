import React, { useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { Search } from 'lucide-react-native';
import { fonts, shadow, tw } from '../../theme';
import { Text } from './Text';

const SIZES = {
  sm: { h: 36, px: 12, text: 14, iconPad: 36 },
  md: { h: 44, px: 14, text: 14, iconPad: 40 },
};

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  size?: keyof typeof SIZES;
  variant?: 'text' | 'search';
  leadingIcon?: React.ReactNode;
}

export function TextField({ label, hint, error, required, size = 'md', variant = 'text', leadingIcon, ...rest }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const s = SIZES[size];
  const icon = variant === 'search' ? <Search size={16} color="#9CA3AF" /> : leadingIcon;
  const border = error ? '#EF4444' : focused ? '#111827' : '#D1D5DB';
  return (
    <View style={tw`w-full gap-1.5`}>
      {label ? (
        <Text style={tw`text-sm font-medium text-[#374151]`}>
          {label}
          {required ? <Text style={tw`text-[#EF4444]`}> *</Text> : null}
        </Text>
      ) : null}
      <View style={tw`justify-center`}>
        {icon ? <View style={[tw`absolute z-10`, { left: s.px - 1 }]}>{icon}</View> : null}
        <TextInput
          {...rest}
          accessibilityLabel={rest.accessibilityLabel ?? label}
          placeholderTextColor="#9CA3AF"
          returnKeyType={variant === 'search' ? 'search' : rest.returnKeyType}
          autoCorrect={variant === 'search' ? false : rest.autoCorrect}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[
            tw`w-full rounded-lg bg-white text-[#111827]`,
            shadow.sm,
            {
              height: s.h,
              paddingHorizontal: s.px,
              paddingLeft: icon ? s.iconPad : s.px,
              fontSize: s.text,
              fontFamily: fonts.body,
              borderWidth: 1,
              borderColor: border,
            },
          ]}
        />
      </View>
      {error ? (
        <Text style={tw`text-sm text-[#DC2626]`}>{error}</Text>
      ) : hint ? (
        <Text style={tw`text-sm text-[#6B7280]`}>{hint}</Text>
      ) : null}
    </View>
  );
}

