import React from 'react';
import { Image } from 'react-native';
import { colors } from '../../theme';

export const LOGO_ASPECT = 846 / 320;

export function Logo({ width = 140, tone = 'navy' }: { width?: number; tone?: 'navy' | 'white' }) {
  return (
    <Image
      source={require('../../assets/logo.png')}
      accessibilityLabel="DALI Lab"
      resizeMode="contain"
      style={{ width, height: width / LOGO_ASPECT, tintColor: tone === 'white' ? colors.white : undefined }}
    />
  );
}
