import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { colors, tw } from '../theme';
import { IconButton } from './ui/IconButton';
import { Text } from './ui/Text';

interface NavHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onBack: () => void;
  trailing?: React.ReactNode;
}

export function NavHeader({ title, subtitle, onBack, trailing }: NavHeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[tw`border-b border-slate-200 bg-white`, { paddingTop: insets.top }]}>
      <View style={tw`flex-row items-center gap-1 px-2 py-2`}>
        <IconButton label="Back" onPress={onBack}>
          <ChevronLeft size={22} color={colors.navy} />
        </IconButton>
        <View style={tw`flex-1`}>
          {typeof title === 'string' ? (
            <Text accessibilityRole="header" numberOfLines={1} style={tw`text-base font-bold text-cool-black`}>
              {title}
            </Text>
          ) : (
            title
          )}
          {subtitle ? (
            typeof subtitle === 'string' ? (
              <Text numberOfLines={1} style={tw`text-xs text-slate-500`}>
                {subtitle}
              </Text>
            ) : (
              subtitle
            )
          ) : null}
        </View>
        {trailing}
      </View>
    </View>
  );
}
