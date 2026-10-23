import React, { useMemo, useRef } from 'react';
import { Animated, PanResponder, Pressable, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import { Text } from './Text';

export interface SwipeAction {
  label: string;
  icon: LucideIcon;
  color: string;
  onPress: () => void;
}

const ACTION_WIDTH = 76;

/** A row that slides left to reveal its actions. Screen readers get the same actions as accessibility actions. */
export function SwipeRow({ actions, children }: { actions: SwipeAction[]; children: React.ReactNode }) {
  const width = actions.length * ACTION_WIDTH;
  const x = useRef(new Animated.Value(0)).current;
  const open = useRef(false);

  const settle = (toOpen: boolean) => {
    open.current = toOpen;
    Animated.spring(x, { toValue: toOpen ? -width : 0, damping: 30, stiffness: 320, useNativeDriver: true }).start();
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, g) => {
          const start = open.current ? -width : 0;
          x.setValue(Math.max(-width - 24, Math.min(0, start + g.dx)));
        },
        onPanResponderRelease: (_, g) => {
          const start = open.current ? -width : 0;
          settle(g.vx < -0.4 || (g.vx <= 0.4 && start + g.dx < -width / 2));
        },
        onPanResponderTerminate: () => settle(open.current),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width],
  );

  return (
    <View
      accessibilityActions={actions.map((a) => ({ name: a.label, label: a.label }))}
      onAccessibilityAction={(e) => actions.find((a) => a.label === e.nativeEvent.actionName)?.onPress()}>
      <View style={[tw`absolute bottom-0 right-0 top-0 flex-row`, { width }]}>
        {actions.map(({ label, icon: I, color, onPress }) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => {
              settle(false);
              onPress();
            }}
            style={[tw`items-center justify-center gap-1`, { width: ACTION_WIDTH, backgroundColor: color }]}>
            <I size={18} color={colors.white} />
            <Text style={tw`text-xs font-bold text-white`}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Animated.View {...responder.panHandlers} style={[tw`bg-white`, { transform: [{ translateX: x }] }]}>
        {children}
      </Animated.View>
    </View>
  );
}
