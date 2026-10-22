import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { CloudOff, RefreshCw } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import { Button } from './Button';
import { Text } from './Text';

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <View accessibilityLabel={label} style={tw`flex-1 items-center justify-center py-16`}>
      <ActivityIndicator color={colors.teal} />
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={tw`items-center px-8 py-16`}>
      <CloudOff size={28} color={colors.slate400} />
      <Text style={tw`mt-2 font-bold text-cool-black`}>Couldn’t load this</Text>
      <Text style={tw`mt-0.5 text-center text-sm text-slate-500`}>{message}</Text>
      <Button size="sm" variant="secondary" color="navy" leftIcon={RefreshCw} onPress={onRetry} style={tw`mt-4`}>
        Try again
      </Button>
    </View>
  );
}
