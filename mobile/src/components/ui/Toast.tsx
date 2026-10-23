import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { CheckCircle2 } from 'lucide-react-native';
import { colors, shadow, tw } from '../../theme';
import { Text } from './Text';

/** A short status message above the tab bar; clears itself after a few seconds. */
export function Toast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  const t = useRef(new Animated.Value(0)).current;
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (!message) return;
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    const id = setTimeout(() => dismiss.current(), 2600);
    return () => clearTimeout(id);
  }, [message, t]);

  if (!message) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        tw`absolute inset-x-0 bottom-4 items-center px-4`,
        { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] },
      ]}>
      <View style={[tw`flex-row items-center gap-2 rounded-full bg-cool-black px-4 py-2.5`, shadow.lg]}>
        <CheckCircle2 size={16} color={colors.lightTeal} />
        <Text style={tw`text-sm font-bold text-white`}>{message}</Text>
      </View>
    </Animated.View>
  );
}
