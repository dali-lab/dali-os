import React, { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import { Camera, ChevronRight, Receipt } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import { useExpenses } from '../../contexts/ExpensesContext';
import { NavHeader } from '../NavHeader';
import { Button } from '../ui/Button';
import { ErrorState, LoadingState } from '../ui/StateViews';
import { Text } from '../ui/Text';
import { formatMoney, StatusPills } from './StatusPills';

function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : format(d, 'MMM d');
}

export function ExpenseListScreen({ onBack, onAdd, onOpen }: { onBack: () => void; onAdd: () => void; onOpen: (id: string) => void }) {
  const { expenses, error, loadExpenses } = useExpenses();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void loadExpenses();
  }, [loadExpenses]);

  const refresh = async () => {
    setRefreshing(true);
    await loadExpenses();
    setRefreshing(false);
  };

  return (
    <View style={tw`flex-1 bg-cool-white`}>
      <NavHeader title="Your expenses" onBack={onBack} />
      <ScrollView
        contentContainerStyle={[tw`px-4 pt-4`, { paddingBottom: 96 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.teal} colors={[colors.teal]} />}>
        {!expenses && error ? <ErrorState message={error} onRetry={() => void loadExpenses()} /> : null}
        {!expenses && !error ? <LoadingState /> : null}
        {expenses && expenses.length === 0 ? (
          <View style={tw`items-center px-8 py-16`}>
            <Receipt size={28} color={colors.slate400} />
            <Text style={tw`mt-2 font-bold text-cool-black`}>No expenses yet</Text>
            <Text style={tw`mt-0.5 text-center text-sm text-slate-500`}>Photograph a receipt and DALI OS fills in the details.</Text>
          </View>
        ) : null}
        {expenses && expenses.length > 0 ? (
          <View style={tw`overflow-hidden rounded-2xl border border-slate-200 bg-white`}>
            {expenses.map((e, i) => (
              <Pressable
                key={e.id}
                accessibilityRole="button"
                onPress={() => onOpen(e.id)}
                style={({ pressed }) => [tw`flex-row items-center gap-3 px-4 py-3`, i > 0 && tw`border-t border-slate-100`, pressed && tw`bg-slate-100`]}>
                <View style={tw`flex-1 gap-1`}>
                  <Text numberOfLines={1} style={tw`font-bold text-cool-black`}>
                    {e.merchant ?? 'Receipt'}
                  </Text>
                  <Text numberOfLines={1} style={tw`text-xs text-slate-500`}>
                    {[shortDate(e.purchasedAt), e.category?.label].filter(Boolean).join(' · ') || 'No details yet'}
                  </Text>
                  <StatusPills expense={e} />
                </View>
                <Text style={tw`font-bold text-cool-black`}>{formatMoney(e.total)}</Text>
                <ChevronRight size={16} color={colors.slate400} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
      <View style={[tw`absolute inset-x-0 bottom-0 border-t border-slate-200 bg-white px-4 pt-3`, { paddingBottom: 12 + insets.bottom }]}>
        <Button fullWidth size="lg" leftIcon={Camera} onPress={onAdd}>
          Add receipt
        </Button>
      </View>
    </View>
  );
}
