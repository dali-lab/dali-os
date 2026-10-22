import React, { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { SendHorizontal } from 'lucide-react-native';
import { colors, fonts, tw } from '../../theme';

interface ComposerProps {
  placeholder: string;
  onSend: (text: string) => void;
}

export function Composer({ placeholder, onSend }: ComposerProps) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const canSend = Boolean(value.trim());

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue('');
  };

  return (
    <View style={tw`border-t border-slate-200 bg-white px-3 py-2`}>
      <View style={[tw`flex-row items-end gap-2 rounded-2xl border bg-white px-3 py-1.5`, { borderColor: focused ? colors.teal : colors.slate300 }]}>
        <TextInput
          accessibilityLabel={placeholder}
          multiline
          value={value}
          onChangeText={setValue}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={colors.slate400}
          textAlignVertical="center"
          style={[
            tw`flex-1 text-[15px] text-cool-black`,
            { fontFamily: fonts.body, lineHeight: 20, paddingTop: 6, paddingBottom: 6, minHeight: 32, maxHeight: 112 },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={submit}
          style={({ pressed }) => [
            tw`h-8 w-8 items-center justify-center rounded-full`,
            { backgroundColor: !canSend ? colors.slate200 : pressed ? '#1E9B9B' : colors.teal },
          ]}>
          <SendHorizontal size={16} color={canSend ? colors.white : colors.slate400} />
        </Pressable>
      </View>
    </View>
  );
}
