import React from 'react';
import { View } from 'react-native';
import { CalendarClock, Eye, Play, Timer } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import { useTime } from '../../contexts/TimeContext';
import { useMembers } from '../../contexts/useMembers';
import type { Project } from '../../types/project';
import { TilePattern } from '../brand/TilePattern';
import { AvatarStack } from '../ui/AvatarStack';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';

interface ProjectHeaderProps {
  project: Project;
  inReviewCount: number;
  daysLeft: number | null;
  onStartTimer: () => void;
}

export function ProjectHeader({ project, inReviewCount, daysLeft, onStartTimer }: ProjectHeaderProps) {
  const { getMember } = useMembers();
  const { timer } = useTime();
  const { doneCount, totalCount } = project;
  const pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
  const extra = project.memberIds.length - 5;

  return (
    <View style={tw`px-4 pt-4`}>
      <View style={tw`overflow-hidden rounded-2xl bg-navy p-5`}>
        <TilePattern rows={2} columns={3} tileSize={36} seed={11} density={0.75} style={tw`absolute right-0 top-0`} />
        <View>
          <Text style={tw`font-eyebrow text-[11px] uppercase tracking-widest text-pale-teal`}>Your project</Text>
          <Text accessibilityRole="header" style={tw`mt-1 font-heading text-3xl text-white`}>
            {project.name}
          </Text>
          <View style={tw`mt-2 flex-row flex-wrap items-center gap-1.5`}>
            <View style={tw`flex-row items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5`}>
              <View style={tw`h-1.5 w-1.5 rounded-full bg-light-green`} />
              <Text style={tw`text-xs font-bold text-white`}>{project.status}</Text>
            </View>
            {project.terms.map((t) => (
              <View key={t} style={tw`rounded-full border border-white/25 px-2 py-0.5`}>
                <Text style={tw`font-eyebrow text-[11px] text-white`}>{t}</Text>
              </View>
            ))}
          </View>
          {project.myRole ? (
            <Text style={tw`mt-3 text-sm text-white/80`}>
              You’re on <Text style={tw`font-bold text-white`}>{project.myRole}</Text>
              {project.myLeadRole ? ` · ${project.myLeadRole}` : ''}
            </Text>
          ) : null}
        </View>

        <View style={tw`mt-5 rounded-xl bg-white/10 p-3`}>
          <View style={tw`flex-row items-center justify-between`}>
            <View style={tw`flex-row items-center gap-1.5`}>
              <CalendarClock size={15} color={colors.white} />
              <Text style={tw`text-sm font-bold text-white`}>{project.sprint ? `Sprint ${project.sprint.number}` : 'Progress'}</Text>
            </View>
            <Text style={tw`text-sm text-white/80`}>
              {daysLeft === null ? '' : daysLeft > 0 ? `ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` : 'ends today'}
            </Text>
          </View>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel="Project tasks completed"
            accessibilityValue={{ min: 0, max: 100, now: pct }}
            style={tw`mt-2.5 h-2 overflow-hidden rounded-full bg-white/20`}>
            <View style={[tw`h-full rounded-full bg-teal`, { width: `${pct}%` }]} />
          </View>
          <View style={tw`mt-2 flex-row items-center justify-between`}>
            <Text style={tw`text-xs text-white/80`}>
              <Text style={tw`font-bold text-white`}>{doneCount}</Text>/{totalCount} tasks done
            </Text>
            <View style={tw`flex-row items-center gap-1`}>
              <Eye size={12} color="rgba(255,255,255,0.8)" />
              <Text style={tw`text-xs text-white/80`}>{inReviewCount} in review</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={tw`mt-3 flex-row items-center justify-between gap-3`}>
        <View accessibilityLabel={`${project.memberIds.length} teammates`}>
          <AvatarStack names={project.memberIds.map((id) => getMember(id)?.name ?? '?')} overlap={8} extra={extra > 0 ? extra : undefined} />
        </View>
        <Button size="sm" variant="secondary" color="navy" leftIcon={timer ? Timer : Play} onPress={onStartTimer}>
          {timer ? 'Timer running' : 'Start timer'}
        </Button>
      </View>
    </View>
  );
}
