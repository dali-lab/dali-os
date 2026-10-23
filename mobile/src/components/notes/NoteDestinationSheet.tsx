import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { BookOpen, ChevronRight, Search, User } from 'lucide-react-native';
import { colors, fonts, tw } from '../../theme';
import { api, errorMessage } from '../../api/client';
import type { Notebook } from '../../api/contract';
import type { NoteDestination } from '../../utils/notePages';
import { formatShortDate } from '../../utils/time';
import { BottomSheet } from '../ui/BottomSheet';
import { Eyebrow } from '../ui/Eyebrow';
import { Text } from '../ui/Text';

interface NoteDestinationSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  onPick: (destination: NoteDestination) => void;
}

function Row({ icon, label, detail, onPress }: { icon: React.ReactNode; label: string; detail?: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [tw`flex-row items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5`, pressed && tw`bg-slate-50`]}>
      <View style={tw`h-8 w-8 items-center justify-center rounded-lg bg-pale-blue`}>{icon}</View>
      <View style={tw`flex-1`}>
        <Text numberOfLines={1} style={tw`text-sm font-bold text-cool-black`}>
          {label}
        </Text>
        {detail ? (
          <Text numberOfLines={1} style={tw`text-xs text-slate-500`}>
            {detail}
          </Text>
        ) : null}
      </View>
      <ChevronRight size={16} color={colors.slate400} />
    </Pressable>
  );
}

/** Pick where a new note goes, the way the web's notebook picker does: your notes, or a notebook you can edit. */
export function NoteDestinationSheet({ open, title, onClose, onPick }: NoteDestinationSheetProps) {
  const [query, setQuery] = useState('');
  const [notebooks, setNotebooks] = useState<Notebook[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    const timer = setTimeout(() => {
      api
        .notebooks(query.trim())
        .then((r) => !cancelled && setNotebooks(r.notebooks))
        .catch((err) => !cancelled && setError(errorMessage(err)));
    }, query ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const suggested = (notebooks ?? []).filter((n) => n.suggested);
  const rest = (notebooks ?? []).filter((n) => !n.suggested);
  const notebookRow = (n: Notebook) => (
    <Row
      key={n.id}
      icon={<BookOpen size={16} color={colors.navy} />}
      label={n.title}
      detail={[n.path, `${n.tabCount} note${n.tabCount === 1 ? '' : 's'}`, n.lastNoteAt ? `last ${formatShortDate(n.lastNoteAt)}` : null].filter(Boolean).join(' · ')}
      onPress={() => onPick({ kind: 'notebook', notebook: n })}
    />
  );

  return (
    <BottomSheet open={open} onClose={onClose} title={title} description="Choose where this note is filed">
      <Row icon={<User size={16} color={colors.navy} />} label="My notes" detail="Private to you until you share it" onPress={() => onPick({ kind: 'personal' })} />

      <View style={tw`mt-4 h-10 flex-row items-center gap-2 rounded-xl border border-slate-200 bg-white px-3`}>
        <Search size={16} color={colors.slate400} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search notebooks"
          placeholderTextColor={colors.slate400}
          accessibilityLabel="Search notebooks"
          autoCorrect={false}
          returnKeyType="search"
          style={[tw`flex-1 text-sm text-cool-black`, { fontFamily: fonts.body }]}
        />
      </View>

      {error ? <Text style={tw`mt-3 text-sm text-dark-coral`}>{error}</Text> : null}
      {!notebooks && !error ? <ActivityIndicator style={tw`mt-6`} color={colors.teal} /> : null}
      {notebooks && notebooks.length === 0 ? (
        <Text style={tw`mt-4 text-center text-sm text-slate-500`}>{query ? 'No notebooks match.' : 'You have no notebooks yet. Make one in DALI OS.'}</Text>
      ) : null}
      {suggested.length > 0 ? (
        <>
          <Eyebrow style={tw`mt-4`}>Suggested</Eyebrow>
          <View style={tw`mt-2 gap-2`}>{suggested.map(notebookRow)}</View>
        </>
      ) : null}
      {rest.length > 0 ? (
        <>
          <Eyebrow style={tw`mt-4`}>{suggested.length > 0 ? 'Other notebooks' : 'Notebooks'}</Eyebrow>
          <View style={tw`mt-2 gap-2`}>{rest.map(notebookRow)}</View>
        </>
      ) : null}
    </BottomSheet>
  );
}
