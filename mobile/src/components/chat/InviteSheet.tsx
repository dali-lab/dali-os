import React, { useEffect, useState } from 'react';
import { tw } from '../../theme';
import { useChat } from '../../contexts/ChatContext';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { PeoplePicker } from './PeoplePicker';

interface InviteSheetProps {
  conversationId: string | null;
  onClose: () => void;
  onConfirm: (conversationId: string, userIds: string[]) => void;
}

export function InviteSheet({ conversationId, onClose, onConfirm }: InviteSheetProps) {
  const { conversations, users } = useChat();
  const [selected, setSelected] = useState<string[]>([]);
  const conversation = conversations.find((c) => c.id === conversationId);

  useEffect(() => {
    if (!conversationId) setSelected([]);
  }, [conversationId]);

  const isChannel = conversation?.kind === 'channel';
  const candidates = users.filter((u) => !conversation?.memberIds.includes(u.id));

  return (
    <BottomSheet
      open={Boolean(conversation)}
      onClose={onClose}
      title={isChannel ? `Add people to #${conversation?.name}` : 'Add to conversation'}
      description={isChannel ? 'They’ll be able to see the channel history' : 'This starts a new group message'}
      footer={
        <Button fullWidth disabled={selected.length === 0} onPress={() => conversation && onConfirm(conversation.id, selected)}>
          {selected.length ? `Add ${selected.length} ${selected.length === 1 ? 'person' : 'people'}` : 'Add people'}
        </Button>
      }>
      {candidates.length === 0 ? (
        <Text style={tw`py-8 text-center text-sm text-slate-500`}>Everyone at DALI is already here.</Text>
      ) : (
        <PeoplePicker candidates={candidates} selectedIds={selected} onChange={setSelected} />
      )}
    </BottomSheet>
  );
}
