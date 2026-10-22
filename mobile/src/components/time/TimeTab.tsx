import React, { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Plus, RefreshCw } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import type { TimeEntry } from '../../api/contract';
import { useTime } from '../../contexts/TimeContext';
import { useNow } from '../../hooks/useNow';
import { TopBar } from '../TopBar';
import { Eyebrow } from '../ui/Eyebrow';
import { IconButton } from '../ui/IconButton';
import { ErrorState, LoadingState } from '../ui/StateViews';
import { Text } from '../ui/Text';
import { Toast } from '../ui/Toast';
import { EntryList } from './EntryList';
import { EntrySheet } from './EntrySheet';
import { PeriodSummary } from './PeriodSummary';
import { TimerCard } from './TimerCard';

export function TimeTab({ onOpenProfile }: { onOpenProfile: () => void }) {
  const { data, error, roles, entries, timer, load } = useTime();
  const now = useNow(1000, Boolean(timer));
  const [sheet, setSheet] = useState<{ open: boolean; entry: TimeEntry | null }>({ open: false, entry: null });
  const [toast, setToast] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!data && !error) void load();
  }, [data, error, load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const runningHours = timer ? Math.max(0, (now.getTime() - new Date(timer.startedAt).getTime()) / 3_600_000) : 0;
  const addTime = () => setSheet({ open: true, entry: null });

  return (
    <View style={tw`flex-1 bg-cool-white`}>
      <TopBar
        title="Time"
        onOpenProfile={onOpenProfile}
        actions={
          <IconButton label="Add time manually" onPress={addTime} disabled={roles.length === 0}>
            <Plus size={20} color={colors.navy} />
          </IconButton>
        }
      />
      <ScrollView
        contentContainerStyle={tw`pb-8`}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.teal} colors={[colors.teal]} />}>
        {!data && error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
        {!data && !error ? <LoadingState /> : null}
        {data ? (
          <>
            <TimerCard onMessage={setToast} />
            <PeriodSummary
              period={data.period}
              today={data.today}
              roles={roles}
              entries={entries}
              runningHours={runningHours}
              runningRoleId={timer?.roleRefId}
            />

            <View style={tw`px-4 pt-6`}>
              <View style={tw`flex-row items-center justify-between`}>
                <Eyebrow>Entries</Eyebrow>
                {roles.length > 0 ? (
                  <Pressable accessibilityRole="button" onPress={addTime} hitSlop={8} style={tw`flex-row items-center gap-1`}>
                    <Plus size={14} color={colors.teal} />
                    <Text style={tw`text-sm font-bold text-teal`}>Add time</Text>
                  </Pressable>
                ) : null}
              </View>
              <EntryList entries={entries} roles={roles} onOpen={(entry) => setSheet({ open: true, entry })} />
            </View>

            <View style={tw`mt-5 flex-row items-center justify-center gap-1.5 px-4`}>
              <RefreshCw size={12} color={colors.slate500} />
              <Text style={tw`text-xs text-slate-500`}>Every entry logs straight to your DALI OS timesheet</Text>
            </View>
          </>
        ) : null}
      </ScrollView>
      <EntrySheet open={sheet.open} entry={sheet.entry} onClose={() => setSheet((s) => ({ ...s, open: false }))} onSaved={setToast} />
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </View>
  );
}
