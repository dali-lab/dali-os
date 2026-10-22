import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Hash, Lock } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import { errorMessage } from '../../api/client';
import { useChat } from '../../contexts/ChatContext';
import { toChannelSlug } from '../../utils/chat';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { TextField } from '../ui/TextField';
import { PeoplePicker } from './PeoplePicker';

interface CreateChannelSheetProps {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}

const PRIVACY_OPTIONS = [
  { value: false, title: 'Public', body: 'Anyone at DALI can find and join', icon: Hash },
  { value: true, title: 'Private', body: 'Only people you invite can see it', icon: Lock },
];

export function CreateChannelSheet({ open, onClose, onCreated }: CreateChannelSheetProps) {
  const { conversations, users, meId, createChannel } = useChat();
  const [step, setStep] = useState<'details' | 'members'>('details');
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) return;
    setStep('details');
    setName('');
    setTopic('');
    setIsPrivate(false);
    setMemberIds([]);
    setError(undefined);
  }, [open]);

  const slug = toChannelSlug(name);

  const goNext = () => {
    if (!slug) return setError('Give your channel a name.');
    if (conversations.some((c) => c.kind === 'channel' && c.name === slug)) return setError(`#${slug} already exists.`);
    setError(undefined);
    setStep('members');
  };

  const create = async () => {
    setCreating(true);
    try {
      onCreated(await createChannel({ name: slug, topic, isPrivate, memberIds }));
    } catch (err) {
      setError(errorMessage(err));
      setStep('details');
    } finally {
      setCreating(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={step === 'details' ? 'Create a channel' : `Add people to #${slug}`}
      description={step === 'details' ? 'Step 1 of 2 · Details' : 'Step 2 of 2 · You can skip this'}
      footer={
        step === 'details' ? (
          <Button fullWidth onPress={goNext}>
            Next
          </Button>
        ) : (
          <View style={tw`flex-row gap-2`}>
            <Button variant="ghost" onPress={() => setStep('details')}>
              Back
            </Button>
            <View style={tw`flex-1`}>
              <Button fullWidth loading={creating} onPress={() => void create()}>
                {memberIds.length ? `Create & add ${memberIds.length}` : 'Create channel'}
              </Button>
            </View>
          </View>
        )
      }>
      {step === 'details' ? (
        <View style={tw`gap-4`}>
          <TextField
            label="Name"
            required
            placeholder="e.g. ipad-app"
            value={name}
            onChangeText={setName}
            autoCapitalize="none"
            autoCorrect={false}
            error={error}
            hint={!error && slug ? `Will appear as #${slug}` : undefined}
            leadingIcon={<Hash size={16} color="#9CA3AF" />}
          />
          <TextField label="Topic" placeholder="What’s this channel about?" value={topic} onChangeText={setTopic} />
          <View>
            <Text style={tw`text-sm font-bold text-cool-black`}>Visibility</Text>
            <View accessibilityRole="radiogroup" style={tw`mt-2 gap-2`}>
              {PRIVACY_OPTIONS.map(({ value, title, body, icon: I }) => {
                const selected = isPrivate === value;
                return (
                  <Pressable
                    key={title}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => setIsPrivate(value)}
                    style={[tw`flex-row items-center gap-3 rounded-xl border px-3 py-3`, selected ? tw`border-teal bg-[#E6F7F7]` : tw`border-slate-200`]}>
                    <I size={18} color={colors.navy} />
                    <View style={tw`flex-1`}>
                      <Text style={tw`text-sm font-bold text-cool-black`}>{title}</Text>
                      <Text style={tw`text-xs text-slate-500`}>{body}</Text>
                    </View>
                    <View style={[tw`h-4 w-4 rounded-full`, selected ? tw`border-[5px] border-teal` : tw`border-2 border-slate-300`]} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      ) : (
        <PeoplePicker candidates={users.filter((u) => u.id !== meId)} selectedIds={memberIds} onChange={setMemberIds} />
      )}
    </BottomSheet>
  );
}
