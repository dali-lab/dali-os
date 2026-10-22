import React from 'react';
import { Pressable, View } from 'react-native';
import { AtSign, Fingerprint, LogOut, Mail, MapPin, RefreshCw, Server } from 'lucide-react-native';
import { colors, tw } from '../theme';
import { ENVIRONMENTS } from '../api/env';
import { useAuth } from '../contexts/AuthContext';
import { useChat } from '../contexts/ChatContext';
import { useData } from '../contexts/DataContext';
import type { Presence } from '../types/user';
import { roleTone } from '../utils/roles';
import { Avatar } from './ui/Avatar';
import { BottomSheet } from './ui/BottomSheet';
import { Button } from './ui/Button';
import { Eyebrow } from './ui/Eyebrow';
import { Tag } from './ui/Tag';
import { Text } from './ui/Text';
import { PRESENCE_COLOR, PRESENCE_LABEL } from './PresenceDot';

const PRESENCE_OPTIONS: Presence[] = ['active', 'away'];

interface ProfileSheetProps {
  open: boolean;
  onClose: () => void;
  onSignOut: () => void;
}

export function ProfileSheet({ open, onClose, onSignOut }: ProfileSheetProps) {
  const { setPresence } = useChat();
  const { me: meResource } = useData();
  const { environmentId, setEnvironment } = useAuth();
  const profile = meResource.data;
  if (!profile) return null;
  const me = profile.user;

  const rows = [
    { icon: AtSign, label: 'Handle', value: me.handle ? `@${me.handle}` : null },
    { icon: Fingerprint, label: 'NetID', value: profile.netId },
    { icon: Mail, label: 'Email', value: profile.emails[0] ?? null },
    { icon: MapPin, label: 'Based in', value: profile.basedIn },
  ].filter((r): r is { icon: typeof AtSign; label: string; value: string } => Boolean(r.value));

  return (
    <BottomSheet open={open} onClose={onClose} title="Your profile">
      <View style={tw`flex-row items-center gap-4`}>
        <Avatar name={me.name} size="lg" />
        <View style={tw`flex-1`}>
          <Text style={tw`font-heading text-xl text-cool-black`}>{me.name}</Text>
          <Text style={tw`text-sm text-slate-500`}>
            {[me.title, me.term && `Term ${me.term}`].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>

      <View style={tw`mt-5`} accessibilityRole="radiogroup" accessibilityLabel="Status">
        <Eyebrow>Status</Eyebrow>
        <View style={tw`mt-2 flex-row gap-2`}>
          {PRESENCE_OPTIONS.map((value) => {
            const selected = me.presence === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => setPresence(value)}
                style={[
                  tw`flex-1 flex-row items-center gap-2 rounded-xl border px-3 py-2.5`,
                  selected ? tw`border-teal bg-[#E6F7F7]` : tw`border-slate-200`,
                ]}>
                <View style={[tw`h-2.5 w-2.5 rounded-full`, { backgroundColor: PRESENCE_COLOR[value] }]} />
                <Text style={[tw`text-sm font-bold`, selected ? tw`text-navy` : tw`text-dark-gray`]}>{PRESENCE_LABEL[value]}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={tw`mt-5`}>
        <Eyebrow>Roles</Eyebrow>
        <View style={tw`mt-2 flex-row flex-wrap gap-1.5`}>
          {me.roles.map((r) => (
            <Tag key={r} tone={roleTone(r)}>
              {r}
            </Tag>
          ))}
          {profile.leadRoles.map((r) => (
            <Tag key={r} tone="blue">
              {r}
            </Tag>
          ))}
        </View>
      </View>

      {profile.groups.length > 0 ? (
        <View style={tw`mt-5`}>
          <Eyebrow>Groups</Eyebrow>
          <View style={tw`mt-2 flex-row flex-wrap gap-1.5`}>
            {profile.groups.map((g) => (
              <Tag key={g}>{g}</Tag>
            ))}
          </View>
        </View>
      ) : null}

      <View style={tw`mt-5 rounded-xl border border-slate-200`}>
        {rows.map(({ icon: I, label, value }, i) => (
          <View key={label} style={[tw`flex-row items-center gap-3 px-3 py-2.5`, i > 0 && tw`border-t border-slate-100`]}>
            <I size={16} color={colors.slate400} />
            <Text style={tw`text-sm text-slate-500`}>{label}</Text>
            <Text numberOfLines={1} style={tw`ml-auto flex-shrink text-sm text-cool-black`}>
              {value}
            </Text>
          </View>
        ))}
      </View>

      <View style={tw`mt-4 flex-row items-center gap-2`}>
        <RefreshCw size={12} color={colors.slate500} />
        <Text style={tw`text-xs text-slate-500`}>Synced with your DALI OS profile · Edit details on the web</Text>
      </View>

      {__DEV__ ? (
        <View style={tw`mt-5`} accessibilityRole="radiogroup" accessibilityLabel="Server">
          <View style={tw`flex-row items-center gap-1.5`}>
            <Server size={12} color={colors.slate500} />
            <Eyebrow>Server</Eyebrow>
          </View>
          <View style={tw`mt-2 flex-row gap-2`}>
            {ENVIRONMENTS.map((env) => {
              const selected = env.id === environmentId;
              return (
                <Pressable
                  key={env.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => void setEnvironment(env.id)}
                  style={[tw`flex-1 items-center rounded-xl border px-2 py-2`, selected ? tw`border-teal bg-[#E6F7F7]` : tw`border-slate-200`]}>
                  <Text style={[tw`text-xs font-bold`, selected ? tw`text-navy` : tw`text-dark-gray`]}>{env.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={tw`mt-5`}>
        <Button fullWidth variant="outline" color="coral" leftIcon={LogOut} onPress={onSignOut}>
          Sign out
        </Button>
      </View>
    </BottomSheet>
  );
}
