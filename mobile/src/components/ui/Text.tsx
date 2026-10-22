import React from 'react';
import { Text as RNText, StyleSheet, type TextProps } from 'react-native';
import { fonts } from '../../theme';

const BOLD_FAMILY: Record<string, string> = {
  [fonts.body]: fonts.bodyBold,
  [fonts.mono]: fonts.monoMedium,
};

// Custom fonts ship one family per weight, so a bold weight has to swap the family
// instead of relying on fontWeight (which Android ignores and iOS fakes).
export function Text({ style, ...rest }: TextProps) {
  const flat = StyleSheet.flatten(style) ?? {};
  const family = flat.fontFamily ?? fonts.body;
  const weight = Number(flat.fontWeight === 'bold' ? 700 : flat.fontWeight ?? 400);
  const fontFamily = weight >= 500 ? BOLD_FAMILY[family] ?? family : family;
  return <RNText {...rest} style={[flat, { fontFamily, fontWeight: undefined }]} />;
}
