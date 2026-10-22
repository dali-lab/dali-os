import React from 'react';
import { View } from 'react-native';
import { colors, tw } from '../theme';
import type { Presence } from '../types/user';

export const PRESENCE_COLOR: Record<Presence, string> = {
  active: colors.green,
  away: colors.yellow,
  offline: colors.mediumGray,
};

export const PRESENCE_LABEL: Record<Presence, string> = {
  active: 'Active',
  away: 'Away',
  offline: 'Offline',
};

export function PresenceDot({ presence }: { presence: Presence }) {
  return (
    <View
      accessibilityLabel={PRESENCE_LABEL[presence]}
      style={[
        tw`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white`,
        { backgroundColor: PRESENCE_COLOR[presence] },
      ]}
    />
  );
}
