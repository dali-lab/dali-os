import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Check, X } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import type { User } from '../../types/user';
import { Avatar } from '../ui/Avatar';
import { Text } from '../ui/Text';
import { TextField } from '../ui/TextField';

interface PeoplePickerProps {
  candidates: User[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function PeoplePicker({ candidates, selectedIds, onChange }: PeoplePickerProps) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = candidates.filter((u) => !q || u.name.toLowerCase().includes(q) || u.handle.includes(q));
  const selected = candidates.filter((u) => selectedIds.includes(u.id));

  const toggle = (id: string) => onChange(selectedIds.includes(id) ? selectedIds.filter((s) => s !== id) : [...selectedIds, id]);

  return (
    <View>
      <TextField variant="search" size="sm" accessibilityLabel="Search people" placeholder="Search by name or @handle" value={query} onChangeText={setQuery} autoCapitalize="none" />
      {selected.length > 0 ? (
        <View style={tw`mt-3 flex-row flex-wrap gap-1.5`}>
          {selected.map((u) => (
            <Pressable
              key={u.id}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${u.name}`}
              onPress={() => toggle(u.id)}
              style={tw`flex-row items-center gap-1.5 rounded-full bg-pale-blue py-1 pl-1 pr-2`}>
              <Avatar name={u.name} size="xs" />
              <Text style={tw`text-xs font-bold text-navy`}>{u.name.split(' ')[0]}</Text>
              <X size={12} color={colors.navy} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={tw`mt-3`}>
        {filtered.map((u, i) => {
          const isSelected = selectedIds.includes(u.id);
          return (
            <Pressable
              key={u.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
              onPress={() => toggle(u.id)}
              style={[tw`flex-row items-center gap-3 py-2.5`, i > 0 && tw`border-t border-slate-100`]}>
              <Avatar name={u.name} size="sm" />
              <View style={tw`flex-1`}>
                <Text numberOfLines={1} style={tw`text-sm font-bold text-cool-black`}>
                  {u.name}
                </Text>
                <Text numberOfLines={1} style={tw`text-xs text-slate-500`}>
                  @{u.handle} · {u.title}
                </Text>
              </View>
              <View style={[tw`h-5 w-5 items-center justify-center rounded-full border-2`, isSelected ? tw`border-teal bg-teal` : tw`border-slate-300`]}>
                {isSelected ? <Check size={12} strokeWidth={3} color={colors.white} /> : null}
              </View>
            </Pressable>
          );
        })}
        {filtered.length === 0 ? <Text style={tw`py-6 text-center text-sm text-slate-500`}>No one matches “{query}”.</Text> : null}
      </View>
    </View>
  );
}
