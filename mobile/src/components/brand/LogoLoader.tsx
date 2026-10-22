import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, View } from 'react-native';
import { colors } from '../../theme';
import { LOGO_ASPECT } from '../ui/Logo';

const LOGO = require('../../assets/logo.png');
const EASE = Easing.bezier(0.65, 0, 0.35, 1);

function LogoImage({ tone, width, height, opacity = 1 }: { tone: 'navy' | 'white'; width: number; height: number; opacity?: number }) {
  return (
    <Image
      source={LOGO}
      resizeMode="contain"
      style={{ width, height, opacity, tintColor: tone === 'white' ? colors.white : undefined }}
    />
  );
}

/** Logo revealed left to right, then cleared off to the right, on a loop. */
export function LogoLoader({ tone, size }: { tone: 'navy' | 'white'; size: number }) {
  const h = Math.round(size / LOGO_ASPECT);
  const reveal = useRef(new Animated.Value(0)).current;
  const clear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(clear, { toValue: 0, duration: 0, useNativeDriver: false }),
          Animated.timing(reveal, { toValue: 1, duration: 1260, easing: EASE, useNativeDriver: false }),
        ]),
        Animated.delay(840),
        Animated.timing(clear, { toValue: 1, duration: 700, easing: EASE, useNativeDriver: false }),
        Animated.timing(reveal, { toValue: 0, duration: 0, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reveal, clear]);

  const left = clear.interpolate({ inputRange: [0, 1], outputRange: [0, size] });
  const width = Animated.multiply(reveal, Animated.subtract(size, left));
  return (
    <View accessibilityElementsHidden style={{ width: size, height: h }}>
      <LogoImage tone={tone} width={size} height={h} opacity={0.2} />
      <Animated.View style={{ position: 'absolute', top: 0, left, width, height: h, overflow: 'hidden' }}>
        <Animated.View style={{ transform: [{ translateX: Animated.multiply(left, -1) }] }}>
          <LogoImage tone={tone} width={size} height={h} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}
