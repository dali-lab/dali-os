import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { colors, shadow, tw } from '../../theme';
import { IconButton } from './IconButton';
import { Text } from './Text';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const SCREEN_H = Dimensions.get('window').height;

export function BottomSheet({ open, onClose, title, description, children, footer }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(open);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) {
      setMounted(true);
      Animated.spring(progress, { toValue: 1, damping: 34, stiffness: 360, mass: 1, useNativeDriver: true }).start();
    } else if (mounted) {
      Animated.timing(progress, { toValue: 0, duration: 200, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [open, mounted, progress]);

  if (!mounted) return null;

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [SCREEN_H, 0] });

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={tw`flex-1 justify-end`}>
        <Animated.View style={[tw`absolute inset-0 bg-[rgba(11,28,41,0.45)]`, { opacity: progress }]}>
          <Pressable accessibilityLabel="Close" style={tw`flex-1`} onPress={onClose} />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          accessibilityLabel={title}
          style={[tw`rounded-t-3xl bg-white`, shadow.lg, { maxHeight: '90%', transform: [{ translateY }] }]}>
          <View style={tw`mt-2 h-1 w-10 self-center rounded-full bg-slate-200`} />
          <View style={tw`flex-row items-start justify-between gap-3 px-5 pb-3 pt-3`}>
            <View style={tw`flex-1`}>
              <Text accessibilityRole="header" style={tw`font-heading text-lg text-navy`}>
                {title}
              </Text>
              {description ? <Text style={tw`mt-0.5 text-sm text-slate-500`}>{description}</Text> : null}
            </View>
            <IconButton label="Close" onPress={onClose}>
              <X size={20} color={colors.navy} />
            </IconButton>
          </View>
          <ScrollView
            style={tw`shrink`}
            contentContainerStyle={[tw`px-5`, { paddingBottom: footer ? 20 : 20 + insets.bottom }]}
            keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? (
            <View style={[tw`border-t border-slate-100 px-5 pt-3`, { paddingBottom: 12 + insets.bottom }]}>{footer}</View>
          ) : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
