import React, { useEffect, useState } from 'react';
import { errorMessage } from '../../api/client';
import { useChat } from '../../contexts/ChatContext';
import { tw } from '../../theme';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { PeoplePicker } from './PeoplePicker';

interface NewMessageSheetProps {
  open: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
}

export function NewMessageSheet({ open, onClose, onOpen }: NewMessageSheetProps) {
  const { users, meId, openDirectMessage } = useChat();
  const [selected, setSelected] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setSelected([]);
    setError(null);
  }, [open]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      onOpen(await openDirectMessage(selected));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="New message"
      description="Pick one person for a DM, or several for a group"
      footer={
        <Button fullWidth disabled={selected.length === 0} loading={starting} onPress={() => void start()}>
          {selected.length > 1 ? `Start group chat (${selected.length + 1})` : 'Start conversation'}
        </Button>
      }>
      {error ? <Text style={tw`mb-2 text-sm text-coral`}>{error}</Text> : null}
      <PeoplePicker candidates={users.filter((u) => u.id !== meId)} selectedIds={selected} onChange={setSelected} />
    </BottomSheet>
  );
}
