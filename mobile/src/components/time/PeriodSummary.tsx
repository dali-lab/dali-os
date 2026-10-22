import React from 'react';
import { View } from 'react-native';
import { addDays, differenceInCalendarDays, format, startOfWeek } from 'date-fns';
import { ExternalLink } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import type { Role, TimeEntry } from '../../api/contract';
import { formatHours, fromDateKey, toDateKey } from '../../utils/hours';
import { roleColor } from '../../utils/roleColor';
import { Eyebrow } from '../ui/Eyebrow';
import { Text } from '../ui/Text';

const CHART_HEIGHT = 56;

interface PeriodSummaryProps {
  period: { start: string; end: string };
  today: string;
  roles: Role[];
  entries: TimeEntry[];
  runningHours: number;
  runningRoleId?: string;
}

export function PeriodSummary({ period, today, roles, entries, runningHours, runningRoleId }: PeriodSummaryProps) {
  const roleIds = roles.map((r) => r.roleRefId);
  const total = entries.reduce((s, e) => s + e.hours, 0) + runningHours;
  const hoursFor = (roleRefId: string | null) =>
    entries.filter((e) => e.roleRefId === roleRefId).reduce((s, e) => s + e.hours, 0) + (runningRoleId === roleRefId ? runningHours : 0);
  const byRole = [
    ...roles.map((r) => ({ id: r.roleRefId, label: r.label, hours: hoursFor(r.roleRefId) })),
    { id: null, label: 'Other roles', hours: entries.filter((e) => !roleIds.includes(e.roleRefId ?? '')).reduce((s, e) => s + e.hours, 0) },
  ].filter((r) => r.hours > 0);

  const todayDate = fromDateKey(today);
  const end = fromDateKey(period.end);
  const daysLeft = differenceInCalendarDays(end, todayDate);
  const weekStart = startOfWeek(todayDate);
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(weekStart, i);
    const key = toDateKey(day);
    const isToday = key === today;
    const hours = entries.filter((e) => e.day === key).reduce((s, e) => s + e.hours, 0) + (isToday ? runningHours : 0);
    return { day, key, hours, isToday };
  });
  const weekTotal = week.reduce((s, d) => s + d.hours, 0);
  const max = Math.max(4, ...week.map((d) => d.hours));

  return (
    <View style={tw`px-4 pt-4`}>
      <View style={tw`rounded-2xl border border-slate-200 bg-white p-4`}>
        <View style={tw`flex-row items-start justify-between gap-3`}>
          <View>
            <Eyebrow>Pay period</Eyebrow>
            <Text style={tw`text-sm text-dark-gray`}>
              {format(fromDateKey(period.start), 'MMM d')} – {format(end, 'MMM d')}
            </Text>
          </View>
          <View style={[tw`rounded-full px-2.5 py-1`, daysLeft <= 2 ? tw`bg-pale-coral/40` : tw`bg-light-yellow`]}>
            <Text style={[tw`text-xs font-bold`, daysLeft <= 2 ? tw`text-dark-coral` : tw`text-dark-navy`]}>
              {daysLeft <= 0 ? 'Closes today' : `Closes in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}
            </Text>
          </View>
        </View>

        <Text style={[tw`mt-3 font-heading text-3xl text-navy`, { fontVariant: ['tabular-nums'] }]}>{formatHours(total)}</Text>
        <Text style={tw`text-xs text-slate-500`}>logged this period</Text>

        {byRole.length > 0 ? (
          <>
            <View style={tw`mt-3 h-2.5 flex-row overflow-hidden rounded-full bg-slate-100`}>
              {byRole.map((r) => (
                <View key={r.id ?? 'other'} style={{ width: `${(r.hours / total) * 100}%`, backgroundColor: roleColor(roleIds, r.id) }} />
              ))}
            </View>
            <View style={tw`mt-2.5 gap-1`}>
              {byRole.map((r) => (
                <View key={r.id ?? 'other'} style={tw`flex-row items-center gap-2`}>
                  <View style={[tw`h-2 w-2 rounded-full`, { backgroundColor: roleColor(roleIds, r.id) }]} />
                  <Text numberOfLines={1} style={tw`flex-1 text-sm text-dark-gray`}>
                    {r.label}
                  </Text>
                  <Text style={[tw`text-sm font-bold text-cool-black`, { fontVariant: ['tabular-nums'] }]}>{formatHours(r.hours)}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <View style={tw`mt-4 border-t border-slate-100 pt-3`}>
          <View style={tw`flex-row items-baseline justify-between`}>
            <Text style={tw`text-xs font-bold text-dark-gray`}>This week</Text>
            <Text style={tw`text-xs text-slate-500`}>{formatHours(weekTotal)}</Text>
          </View>
          <View style={tw`mt-2 flex-row gap-2`}>
            {week.map((d) => (
              <View key={d.key} style={tw`flex-1 items-center gap-1`}>
                <View style={[tw`w-full items-center justify-end`, { height: CHART_HEIGHT }]}>
                  <View
                    accessibilityLabel={`${format(d.day, 'EEEE')}: ${formatHours(d.hours)}`}
                    style={[
                      tw`w-full rounded-md`,
                      { maxWidth: 22, height: Math.max(4, (d.hours / max) * CHART_HEIGHT) },
                      d.isToday ? tw`bg-teal` : d.hours > 0 ? tw`bg-pale-teal` : tw`bg-slate-100`,
                    ]}
                  />
                </View>
                <Text style={[tw`text-[11px]`, d.isToday ? tw`font-bold text-teal` : tw`text-slate-400`]}>{format(d.day, 'EEEEE')}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={tw`mt-3 flex-row items-center gap-1.5`}>
          <ExternalLink size={12} color={colors.slate500} />
          <Text style={tw`text-xs text-slate-500`}>Submit your hours in JobX by {format(end, 'EEE, MMM d')}</Text>
        </View>
      </View>
    </View>
  );
}
