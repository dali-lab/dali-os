import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { colors, tw } from '../../theme';
import { Text } from '../ui/Text';
import { LogoLoader } from './LogoLoader';
import { TilePattern } from './TilePattern';

interface LoadingScreenProps {
  messages?: string[];
  messageInterval?: number;
  progress?: number;
  footer?: string;
}

export function LoadingScreen({
  messages = ['Warming up the lab'],
  messageInterval = 2200,
  progress,
  footer = 'Dartmouth Applied Learning & Innovation',
}: LoadingScreenProps) {
  const [index, setIndex] = useState(0);
  const slide = useRef(new Animated.Value(1)).current;
  const bar = useRef(new Animated.Value(0)).current;
  const pct = progress === undefined ? undefined : Math.min(100, Math.max(0, progress));

  useEffect(() => {
    if (messages.length < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % messages.length), messageInterval);
    return () => clearInterval(id);
  }, [messages.length, messageInterval]);

  useEffect(() => {
    slide.setValue(0);
    Animated.timing(slide, { toValue: 1, duration: 350, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: true }).start();
  }, [index, slide]);

  useEffect(() => {
    if (pct === undefined) return;
    Animated.spring(bar, { toValue: pct, stiffness: 120, damping: 20, useNativeDriver: false }).start();
  }, [pct, bar]);

  const message = messages[index] ?? 'Loading';
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`${message}${pct !== undefined ? `, ${Math.round(pct)} percent` : ''}`}
      style={tw`flex-1 items-center justify-center overflow-hidden bg-dark-navy`}>
      <TilePattern rows={3} columns={4} tileSize={56} seed={11} density={0.7} animation="shuffle" speed={0.7} style={tw`absolute -left-6 -top-6 opacity-90`} />
      <TilePattern rows={3} columns={5} tileSize={56} seed={23} density={0.7} animation="wave" speed={0.6} style={tw`absolute -bottom-6 -right-6 opacity-90`} />

      <View style={tw`items-center px-6`}>
        <LogoLoader tone="white" size={300} />
        <View style={tw`mt-8 h-5 overflow-hidden`}>
          <Animated.View
            style={{
              opacity: slide,
              transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
            }}>
            <Text style={[tw`font-mono text-xs uppercase text-pale-teal`, { letterSpacing: 2.6 }]}>
              {message}
              {pct !== undefined ? ` · ${Math.round(pct)}%` : ''}
            </Text>
          </Animated.View>
        </View>
        {pct !== undefined ? (
          <View style={tw`mt-5 h-1.5 w-64 overflow-hidden rounded-full bg-white/15`}>
            <Animated.View
              style={[
                tw`h-full rounded-full`,
                { backgroundColor: colors.teal, width: bar.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) },
              ]}
            />
          </View>
        ) : null}
      </View>

      {footer ? (
        <View style={tw`absolute bottom-10 left-0 right-0 items-center`}>
          <Text style={[tw`font-mono text-[10px] uppercase text-pale-teal opacity-70`, { letterSpacing: 2 }]}>{footer}</Text>
        </View>
      ) : null}
    </View>
  );
}
