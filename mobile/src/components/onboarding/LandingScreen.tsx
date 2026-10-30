import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ExternalLink, FolderKanban, LogIn, Mic, RefreshCw, Ticket, Timer } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import { useAuth } from '../../contexts/AuthContext';
import { TilePattern } from '../brand/TilePattern';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';

const FEATURES = [
  { icon: Timer, label: 'Clock in and out' },
  { icon: Mic, label: 'Record meeting notes' },
  { icon: FolderKanban, label: 'Track your sprint' },
  { icon: Ticket, label: 'Scan into the lab' },
];

function Rise({ delay, children }: { delay: number; children: React.ReactNode }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 450, delay, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: true }).start();
  }, [t, delay]);
  return (
    <Animated.View style={{ opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}

export function LandingScreen() {
  const insets = useSafeAreaInsets();
  const { status, pairing, error, startPairing, reopenPairingPage, cancelPairing } = useAuth();
  return (
    <View style={tw`flex-1 bg-dark-navy`}>
      <View style={[tw`h-[38%]`, { paddingTop: insets.top }]}>
        <TilePattern rows={4} columns={6} fill layout="cluster" density={0.62} seed={8} animation="pop" />
      </View>

      <View style={[tw`flex-1 px-6 pt-6`, { paddingBottom: 32 + insets.bottom }]}>
        <Rise delay={200}>
          <Text style={tw`font-heading text-[32px] leading-tight text-white`}>
            Your lab, <Text style={tw`font-heading text-pale-coral`}>in your pocket.</Text>
          </Text>
        </Rise>

        <Rise delay={450}>
          <View style={tw`mt-5 flex-row flex-wrap`}>
            {FEATURES.map(({ icon: I, label }) => (
              <View key={label} style={tw`mb-2.5 w-1/2 flex-row items-center gap-2 pr-3`}>
                <View style={tw`h-7 w-7 items-center justify-center rounded-lg bg-white/10`}>
                  <I size={15} color={colors.paleTeal} />
                </View>
                <Text style={tw`flex-1 text-sm text-white/85`}>{label}</Text>
              </View>
            ))}
          </View>
        </Rise>

        <View style={tw`mt-auto pt-6`}>
          {pairing ? (
            <PairingPanel code={pairing.userCode} onReopen={reopenPairingPage} onCancel={cancelPairing} />
          ) : (
            <Rise delay={600}>
              {error ? (
                <View accessibilityLiveRegion="polite" style={tw`mb-3 rounded-xl bg-white/10 px-3 py-2.5`}>
                  <Text style={tw`text-center text-sm text-pale-coral`}>{error}</Text>
                </View>
              ) : null}
              <Button fullWidth size="lg" leftIcon={LogIn} loading={status === 'pairing'} onPress={() => void startPairing()}>
                Sign in with your DALI email
              </Button>
              <View style={tw`mt-3 flex-row items-center justify-center gap-1.5`}>
                <RefreshCw size={12} color="rgba(255,255,255,0.65)" />
                <Text style={tw`text-xs text-white/65`}>Uses your DALI OS account · syncs both ways</Text>
              </View>
            </Rise>
          )}
        </View>
      </View>
    </View>
  );
}

function PairingPanel({ code, onReopen, onCancel }: { code: string; onReopen: () => void; onCancel: () => void }) {
  return (
    <Rise delay={0}>
      <View style={tw`rounded-2xl bg-white/10 p-5`}>
        <Text style={tw`font-eyebrow text-[11px] uppercase tracking-widest text-pale-teal`}>Your sign-in code</Text>
        <Text accessibilityLabel={`Sign-in code ${code.split('').join(' ')}`} style={[tw`mt-2 font-mono text-3xl text-white`, { letterSpacing: 4 }]}>
          {code}
        </Text>
        <Text style={tw`mt-2 text-sm text-white/75`}>Check that DALI OS shows this code, then tap Approve.</Text>
        <View style={tw`mt-4 flex-row items-center gap-2`}>
          <ActivityIndicator size="small" color={colors.paleTeal} />
          <Text accessibilityLiveRegion="polite" style={tw`text-sm text-white`}>
            Waiting for approval
          </Text>
        </View>
      </View>
      <View style={tw`mt-4 gap-2`}>
        <Button fullWidth size="lg" leftIcon={ExternalLink} onPress={onReopen}>
          Open sign-in page
        </Button>
        <Pressable accessibilityRole="button" onPress={onCancel} style={tw`items-center py-2`}>
          <Text style={tw`text-sm font-bold text-white/75`}>Cancel</Text>
        </Pressable>
      </View>
    </Rise>
  );
}
