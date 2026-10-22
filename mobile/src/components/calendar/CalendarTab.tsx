import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { addWeeks, format, isSameDay, startOfWeek } from 'date-fns';
import { CalendarCheck } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import { useData, weekKey } from '../../contexts/DataContext';
import type { MeetingTarget } from '../../contexts/NotesContext';
import { useNow } from '../../hooks/useNow';
import { formatClock, formatDayLabel, toMs } from '../../utils/time';
import { TopBar } from '../TopBar';
import { Button } from '../ui/Button';
import { ErrorState, LoadingState } from '../ui/StateViews';
import { Text } from '../ui/Text';
import { EventDetailSheet } from './EventDetailSheet';
import { EventRow } from './EventRow';
import { UpNextCard } from './UpNextCard';
import { WeekStrip } from './WeekStrip';

function NowLine({ now }: { now: Date }) {
  return (
    <View accessibilityLabel={`Now, ${formatClock(now)}`} style={tw`flex-row items-center gap-2 py-0.5`}>
      <Text style={tw`w-14 text-right text-[11px] font-bold text-coral`}>{formatClock(now)}</Text>
      <View style={tw`h-2 w-2 rounded-full bg-coral`} />
      <View style={tw`h-px flex-1 bg-coral`} />
    </View>
  );
}

interface CalendarTabProps {
  onOpenProfile: () => void;
  onRecordMeeting: (meeting: MeetingTarget) => Promise<string | null>;
  onViewNote: (recordingId: string) => void;
}

export function CalendarTab({ onOpenProfile, onRecordMeeting, onViewNote }: CalendarTabProps) {
  const today = useNow(60_000);
  const { weeks, loadWeek, setRsvp } = useData();
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [weekStart, setWeekStart] = useState<Date>(startOfWeek(today));
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const week = weeks[weekKey(weekStart)];
  const events = week?.data ?? [];

  useEffect(() => {
    if (!weeks[weekKey(weekStart)]) void loadWeek(weekStart);
  }, [weekStart, weeks, loadWeek]);

  const refresh = async () => {
    setRefreshing(true);
    await loadWeek(weekStart);
    setRefreshing(false);
  };

  const isToday = isSameDay(selectedDate, today);
  const dayEvents = events
    .filter((e) => !e.isAllDay && isSameDay(new Date(e.start), selectedDate))
    .sort((a, b) => toMs(a.start) - toMs(b.start));
  const allDay = events.filter((e) => e.isAllDay && isSameDay(new Date(e.start), selectedDate));
  const nextEvent = isToday ? dayEvents.find((e) => toMs(e.end) > today.getTime() && e.rsvp !== 'declined') : undefined;
  const nowIndex = isToday ? dayEvents.findIndex((e) => toMs(e.start) > today.getTime()) : -1;

  const goToday = () => {
    setSelectedDate(today);
    setWeekStart(startOfWeek(today));
  };
  const shiftWeek = (delta: number) => {
    const next = addWeeks(weekStart, delta);
    setWeekStart(next);
    setSelectedDate(isSameDay(startOfWeek(today), next) ? today : next);
  };

  return (
    <View style={tw`flex-1 bg-cool-white`}>
      <TopBar
        title={format(weekStart, 'MMMM')}
        onOpenProfile={onOpenProfile}
        actions={
          !isToday ? (
            <Button size="sm" variant="ghost" color="navy" onPress={goToday}>
              Today
            </Button>
          ) : undefined
        }
      />
      <WeekStrip
        weekStart={weekStart}
        selected={selectedDate}
        events={events}
        onSelect={setSelectedDate}
        onPrev={() => shiftWeek(-1)}
        onNext={() => shiftWeek(1)}
      />
      <ScrollView
        contentContainerStyle={tw`pb-8`}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.teal} colors={[colors.teal]} />}>
        {!week?.data && week?.error ? <ErrorState message={week.error} onRetry={() => void loadWeek(weekStart)} /> : null}
        {!week?.data && !week?.error ? <LoadingState /> : null}
        {week?.data ? (
        <>
        {nextEvent ? <UpNextCard event={nextEvent} onOpen={() => setSelectedEventId(nextEvent.id)} /> : null}

        <View style={tw`px-4 pt-5`}>
          <View style={tw`flex-row items-baseline justify-between`}>
            <Text accessibilityRole="header" style={tw`font-heading text-lg text-navy`}>
              {formatDayLabel(selectedDate)}
              {isToday ? <Text style={tw`font-body text-sm text-slate-500`}>{`  ${format(today, 'EEE, MMM d')}`}</Text> : null}
            </Text>
            <Text style={tw`text-xs text-slate-400`}>
              {dayEvents.length} meeting{dayEvents.length === 1 ? '' : 's'}
            </Text>
          </View>

          {allDay.map((e) => (
            <View key={e.id} style={tw`mt-2 self-start rounded-full bg-coral px-3 py-1`}>
              <Text style={tw`font-eyebrow text-[11px] uppercase tracking-wider text-white`}>{e.title}</Text>
            </View>
          ))}

          {dayEvents.length === 0 ? (
            <View style={[tw`mt-3 items-center rounded-2xl border border-medium-gray bg-white px-6 py-10`, { borderStyle: 'dashed' }]}>
              <CalendarCheck size={28} color={colors.teal} />
              <Text style={tw`mt-2 font-bold text-cool-black`}>No meetings</Text>
              <Text style={tw`text-sm text-slate-500`}>Enjoy the open time.</Text>
            </View>
          ) : (
            <View style={tw`mt-3 gap-2`}>
              {dayEvents.map((e, i) => (
                <React.Fragment key={e.id}>
                  {i === nowIndex ? <NowLine now={today} /> : null}
                  <EventRow event={e} onOpen={() => setSelectedEventId(e.id)} />
                </React.Fragment>
              ))}
              {isToday && nowIndex === -1 ? <NowLine now={today} /> : null}
            </View>
          )}
        </View>
        </>
        ) : null}
      </ScrollView>
      <EventDetailSheet
        event={events.find((e) => e.id === selectedEventId)}
        onClose={() => setSelectedEventId(null)}
        onRsvp={(e, rsvp) => void setRsvp(e, rsvp)}
        onRecord={onRecordMeeting}
        onViewNote={(id) => {
          setSelectedEventId(null);
          onViewNote(id);
        }}
      />
    </View>
  );
}
