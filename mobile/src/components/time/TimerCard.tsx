import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Pressable, TextInput, View } from 'react-native';
import { Play, Square, Trash2 } from 'lucide-react-native';
import { colors, fonts, tw } from '../../theme';
import { useTime } from '../../contexts/TimeContext';
import { useNow } from '../../hooks/useNow';
import { errorMessage } from '../../api/client';
import { formatElapsed, MAX_NOTE_LENGTH } from '../../utils/hours';
import { roleColor } from '../../utils/roleColor';
import { formatClock } from '../../utils/time';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';

function Pulse() {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 1400, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [t]);
  return (
    <Animated.View
      style={[
        tw`absolute h-2.5 w-2.5 rounded-full bg-light-green`,
        { opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }), transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }] },
      ]}
    />
  );
}

export function TimerCard({ onMessage }: { onMessage: (message: string) => void }) {
  const { roles, timer, startTimer, updateTimer, stopTimer, discardTimer } = useTime();
  const [draftRole, setDraftRole] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState('');
  const [saving, setSaving] = useState(false);
  const now = useNow(1000, Boolean(timer));

  const running = Boolean(timer);
  const roleIds = roles.map((r) => r.roleRefId);
  const roleId = timer?.roleRefId ?? draftRole ?? roleIds[0] ?? null;
  const note = timer?.note ?? draftNote;
  const elapsed = timer ? (now.getTime() - new Date(timer.startedAt).getTime()) / 1000 : 0;

  const setRole = (id: string) => (timer ? updateTimer({ roleRefId: id }) : setDraftRole(id));
  const setNote = (value: string) => (timer ? updateTimer({ note: value }) : setDraftNote(value));

  const clockOut = async () => {
    if (timer) setDraftRole(timer.roleRefId);
    setSaving(true);
    try {
      onMessage(await stopTimer());
      setDraftNote('');
    } catch (err) {
      Alert.alert('Couldn’t log this time', `${errorMessage(err)} The timer is still running.`);
    } finally {
      setSaving(false);
    }
  };

  const discard = () =>
    Alert.alert('Discard this timer?', 'Nothing will be logged.', [
      { text: 'Keep timing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          discardTimer();
          setDraftNote('');
        },
      },
    ]);

  return (
    <View style={tw`px-4 pt-4`}>
      <View style={[tw`rounded-3xl p-5`, running ? tw`bg-dark-navy` : tw`bg-navy`]}>
        <View style={tw`flex-row items-center justify-between`}>
          <View style={tw`flex-row items-center gap-2`}>
            <View style={tw`h-2.5 w-2.5 items-center justify-center`}>
              {running ? <Pulse /> : null}
              <View style={[tw`h-2.5 w-2.5 rounded-full`, running ? tw`bg-light-green` : tw`bg-white/40`]} />
            </View>
            <Text accessibilityRole="header" style={tw`font-eyebrow text-[11px] uppercase tracking-widest text-pale-teal`}>
              {running ? 'Clocked in' : 'Clocked out'}
            </Text>
          </View>
          {timer ? <Text style={tw`text-xs text-white/70`}>since {formatClock(timer.startedAt)}</Text> : null}
        </View>

        <Text
          accessibilityLabel={running ? `Elapsed ${formatElapsed(elapsed)}` : 'Timer not running'}
          style={[tw`mt-3 font-heading text-[56px] leading-[60px]`, running ? tw`text-white` : tw`text-white/35`, { fontVariant: ['tabular-nums'] }]}>
          {formatElapsed(elapsed)}
        </Text>

        {roles.length > 0 ? (
          <View style={tw`mt-5`}>
            <Text style={tw`text-xs text-white/70`}>Bill time to</Text>
            <View accessibilityRole="radiogroup" style={tw`mt-2 flex-row flex-wrap gap-1.5`}>
              {roles.map((r) => {
                const selected = r.roleRefId === roleId;
                return (
                  <Pressable
                    key={r.roleRefId}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => setRole(r.roleRefId)}
                    style={[tw`flex-row items-center gap-1.5 rounded-full px-3 py-1.5`, selected ? tw`bg-white` : tw`bg-white/10`]}>
                    <View style={[tw`h-2 w-2 rounded-full`, { backgroundColor: roleColor(roleIds, r.roleRefId) }]} />
                    <Text style={[tw`text-sm`, selected ? tw`font-bold text-navy` : tw`text-white/85`]}>{r.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : (
          <Text style={tw`mt-5 text-sm text-white/70`}>You have no paid role this term, so there’s nothing to bill time to.</Text>
        )}

        <TextInput
          value={note}
          onChangeText={setNote}
          maxLength={MAX_NOTE_LENGTH}
          placeholder="What are you working on?"
          placeholderTextColor="rgba(255,255,255,0.5)"
          accessibilityLabel="What are you working on?"
          style={[tw`mt-4 rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white`, { fontFamily: fonts.body }]}
        />

        <View style={tw`mt-4`}>
          {running ? (
            <View style={tw`flex-row items-center gap-2`}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Discard timer"
                onPress={discard}
                style={({ pressed }) => [tw`h-12 w-12 items-center justify-center rounded-full`, pressed ? tw`bg-white/20` : tw`bg-white/10`]}>
                <Trash2 size={18} color="rgba(255,255,255,0.8)" />
              </Pressable>
              <View style={tw`flex-1`}>
                <Button fullWidth size="lg" color="coral" leftIcon={Square} loading={saving} onPress={() => void clockOut()}>
                  Clock out
                </Button>
              </View>
            </View>
          ) : (
            <Button fullWidth size="lg" leftIcon={Play} disabled={!roleId} onPress={() => startTimer(roleId ?? undefined, draftNote.trim())}>
              Clock in
            </Button>
          )}
        </View>
      </View>
    </View>
  );
}
