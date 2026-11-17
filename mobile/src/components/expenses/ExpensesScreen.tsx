import React, { useState } from 'react';
import { View } from 'react-native';
import { tw } from '../../theme';
import { CaptureScreen } from './CaptureScreen';
import { ExpenseDetailScreen } from './ExpenseDetailScreen';
import { ExpenseListScreen } from './ExpenseListScreen';

type View_ = { kind: 'list' } | { kind: 'capture' } | { kind: 'detail'; id: string };

/** Full-screen Expenses flow: list, receipt capture, then the confirm screen. */
export function ExpensesScreen({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<View_>({ kind: 'list' });
  const toList = () => setView({ kind: 'list' });

  return (
    <View style={tw`absolute inset-0 bg-cool-white`}>
      {view.kind === 'list' ? (
        <ExpenseListScreen onBack={onClose} onAdd={() => setView({ kind: 'capture' })} onOpen={(id) => setView({ kind: 'detail', id })} />
      ) : null}
      {view.kind === 'capture' ? <CaptureScreen onBack={toList} onCreated={(id) => setView({ kind: 'detail', id })} /> : null}
      {view.kind === 'detail' ? <ExpenseDetailScreen key={view.id} id={view.id} onBack={toList} /> : null}
    </View>
  );
}
