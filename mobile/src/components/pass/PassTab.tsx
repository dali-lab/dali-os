import React, { useState } from 'react';
import { Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { DoorOpen, Maximize2, Sun, Wallet } from 'lucide-react-native';
import { colors, shadow, tw } from '../../theme';
import { api, errorMessage } from '../../api/client';
import { useData } from '../../contexts/DataContext';
import { formatClock, formatDayLabel } from '../../utils/time';
import { TilePattern } from '../brand/TilePattern';
import { TopBar } from '../TopBar';
import { Button } from '../ui/Button';
import { Eyebrow } from '../ui/Eyebrow';
import { Logo } from '../ui/Logo';
import { ErrorState, LoadingState } from '../ui/StateViews';
import { Text } from '../ui/Text';


export function PassTab({ onOpenProfile }: { onOpenProfile: () => void }) {
  const insets = useSafeAreaInsets();
  const { pass, me, loadPass } = useData();
  const [walletState, setWalletState] = useState<'idle' | 'adding'>('idle');
  const [walletError, setWalletError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await loadPass();
    setRefreshing(false);
  };

  const addToWallet = async () => {
    setWalletState('adding');
    setWalletError(null);
    try {
      const { url } = await api.googleWalletUrl();
      await Linking.openURL(url);
    } catch (err) {
      setWalletError(errorMessage(err));
    } finally {
      setWalletState('idle');
    }
  };

  const data = pass.data;
  const fields = data
    ? [
        { label: 'Term', value: me.data?.user.term || null },
        { label: 'NetID', value: me.data?.netId ?? null },
        { label: 'Since', value: data.memberSince },
      ].filter((f): f is { label: string; value: string } => Boolean(f.value))
    : [];

  return (
    <View style={tw`flex-1 bg-cool-white`}>
      <TopBar title="Pass" onOpenProfile={onOpenProfile} />
      <ScrollView
        contentContainerStyle={tw`px-4 pb-8 pt-4`}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.teal} colors={[colors.teal]} />}>
        {!data && pass.error ? <ErrorState message={pass.error} onRetry={() => void loadPass()} /> : null}
        {!data && !pass.error ? <LoadingState /> : null}
        {data ? (
        <>
        <View accessibilityLabel="DALI member pass" style={[tw`rounded-3xl bg-navy`, shadow.lg]}>
          <View style={tw`overflow-hidden rounded-3xl`}>
            <View style={tw`flex-row items-center justify-between px-5 pb-3 pt-5`}>
              <Logo tone="white" width={96} />
              <Text style={tw`font-eyebrow text-[11px] uppercase tracking-widest text-pale-teal`}>Member pass</Text>
            </View>
            <View style={tw`h-9 overflow-hidden`}>
              <TilePattern rows={1} columns={10} tileSize={36} layout="grid" seed={5} />
            </View>
            <View style={tw`px-5 pt-4`}>
              <Text style={tw`font-eyebrow text-[10px] uppercase tracking-widest text-white/60`}>Member</Text>
              <Text style={tw`font-heading text-2xl text-white`}>{data.name}</Text>
              <View style={tw`mt-3 flex-row gap-3`}>
                {fields.map((f) => (
                  <View key={f.label} style={tw`flex-1`}>
                    <Text style={tw`font-eyebrow text-[10px] uppercase tracking-widest text-white/60`}>{f.label}</Text>
                    <Text style={tw`text-sm font-bold text-white`}>{f.value}</Text>
                  </View>
                ))}
              </View>
              <Text style={tw`mt-3 text-xs text-white/75`}>{data.accessLevel}</Text>
            </View>

            <View style={tw`my-4 flex-row items-center`}>
              <View style={tw`-ml-3 h-6 w-6 rounded-full bg-cool-white`} />
              <View style={[tw`mx-2 flex-1 border-t border-white/30`, { borderStyle: 'dashed' }]} />
              <View style={tw`-mr-3 h-6 w-6 rounded-full bg-cool-white`} />
            </View>

            <View style={tw`items-center px-5 pb-5`}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Show pass code full screen for scanning"
                onPress={() => setFullscreen(true)}
                style={tw`rounded-2xl bg-white p-3`}>
                <QRCode value={data.qrPayload} size={168} color={colors.coolBlack} backgroundColor={colors.white} ecl="M" />
                <View style={tw`absolute bottom-1.5 right-1.5 rounded-full bg-navy p-1`}>
                  <Maximize2 size={12} color={colors.white} />
                </View>
              </Pressable>
              <Text style={tw`mt-3 font-eyebrow text-xs tracking-widest text-white`}>{data.passId}</Text>
              {data.validThrough ? <Text style={tw`mt-1 text-[11px] text-white/70`}>Valid through {data.validThrough}</Text> : null}
            </View>
          </View>
        </View>

        <View style={tw`mt-4`}>
          {Platform.OS === 'android' ? (
            <Button fullWidth color="navy" loading={walletState === 'adding'} leftIcon={Wallet} onPress={() => void addToWallet()}>
              Add to Google Wallet
            </Button>
          ) : null}
          {walletError ? <Text style={tw`mt-2 text-center text-xs text-coral`}>{walletError}</Text> : null}
          <View style={tw`mt-2 flex-row items-center justify-center gap-1.5`}>
            <Sun size={12} color={colors.slate500} />
            <Text style={tw`text-xs text-slate-500`}>Turn up your brightness when scanning at the door</Text>
          </View>
        </View>

        <View style={tw`mt-6`}>
          <Eyebrow>Recent check-ins</Eyebrow>
          {data.checkIns.length === 0 ? (
            <View style={tw`mt-2 rounded-xl border border-slate-200 bg-white px-4 py-5`}>
              <Text style={tw`text-center text-sm text-slate-500`}>No check-ins yet.</Text>
            </View>
          ) : (
            <View style={tw`mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white`}>
              {data.checkIns.map((c, i) => (
                <View key={c.id} style={[tw`flex-row items-center gap-3 px-3 py-2.5`, i > 0 && tw`border-t border-slate-100`]}>
                  <View style={tw`h-8 w-8 items-center justify-center rounded-lg bg-pale-blue`}>
                    <DoorOpen size={15} color={colors.navy} />
                  </View>
                  <Text numberOfLines={1} style={tw`flex-1 text-sm text-cool-black`}>
                    {c.location}
                  </Text>
                  <Text style={tw`text-xs text-slate-500`}>
                    {formatDayLabel(c.at)} · {formatClock(c.at)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
        </>
        ) : null}
      </ScrollView>

      {data ? (
        <Modal visible={fullscreen} animationType="fade" onRequestClose={() => setFullscreen(false)} statusBarTranslucent>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close full screen pass"
            onPress={() => setFullscreen(false)}
            style={[tw`flex-1 items-center justify-center bg-white px-8`, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <Logo width={96} />
            <View style={tw`mt-6 rounded-3xl border border-slate-200 p-4`}>
              <QRCode value={data.qrPayload} size={248} color={colors.coolBlack} backgroundColor={colors.white} ecl="M" />
            </View>
            <Text style={tw`mt-5 font-heading text-xl text-navy`}>{data.name}</Text>
            <Text style={tw`font-eyebrow text-xs tracking-widest text-slate-500`}>{data.passId}</Text>
            <Text style={tw`mt-6 text-center text-sm text-slate-500`}>Hold up to the scanner · Tap anywhere to close</Text>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}
