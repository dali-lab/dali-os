import React from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tw } from '../theme';
import { useMembers } from '../contexts/useMembers';
import { Avatar } from './ui/Avatar';
import { Text } from './ui/Text';
import { PresenceDot } from './PresenceDot';

interface TopBarProps {
  title: string;
  actions?: React.ReactNode;
  onOpenProfile: () => void;
}

export function TopBar({ title, actions, onOpenProfile }: TopBarProps) {
  const insets = useSafeAreaInsets();
  const { getMember, meId } = useMembers();
  const me = getMember(meId);
  return (
    <View style={[tw`border-b border-slate-200 bg-white`, { paddingTop: insets.top }]}>
      <View style={tw`h-12 flex-row items-center justify-between gap-3 px-4`}>
        <Text accessibilityRole="header" numberOfLines={1} style={tw`flex-1 font-heading text-xl text-navy`}>
          {title}
        </Text>
        <View style={tw`flex-row items-center gap-1`}>
          {actions}
          {me ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Open your profile" onPress={onOpenProfile} style={tw`ml-1`}>
              <Avatar name={me.name} size="sm" />
              <PresenceDot presence={me.presence} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}
