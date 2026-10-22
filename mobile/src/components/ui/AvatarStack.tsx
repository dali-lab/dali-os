import React from 'react';
import { View } from 'react-native';
import { tw } from '../../theme';
import { Avatar } from './Avatar';
import { Text } from './Text';

export function AvatarStack({ names, max = 5, overlap = 6, extra }: { names: string[]; max?: number; overlap?: number; extra?: number }) {
  return (
    <View style={tw`flex-row`}>
      {names.slice(0, max).map((name, i) => (
        <View key={`${name}-${i}`} style={i > 0 ? { marginLeft: -overlap } : undefined}>
          <Avatar name={name} size="xs" ring />
        </View>
      ))}
      {extra ? (
        <View style={[tw`h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-slate-200`, { marginLeft: -overlap }]}>
          <Text style={tw`text-[10px] font-bold text-dark-gray`}>+{extra}</Text>
        </View>
      ) : null}
    </View>
  );
}
