import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { differenceInCalendarDays } from 'date-fns';
import { ChevronDown, FolderOpen } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import { useData } from '../../contexts/DataContext';
import { useMembers } from '../../contexts/useMembers';
import type { TaskStatus } from '../../types/project';
import { isClosed, STATUS_META } from '../../utils/taskStatus';
import { now } from '../../utils/time';
import { TopBar } from '../TopBar';
import { Eyebrow } from '../ui/Eyebrow';
import { ErrorState, LoadingState } from '../ui/StateViews';
import { Text } from '../ui/Text';
import { FocusTaskCard } from './FocusTaskCard';
import { ProjectHeader } from './ProjectHeader';
import { TaskDetailSheet } from './TaskDetailSheet';
import { TaskRow } from './TaskRow';

const GROUP_ORDER: TaskStatus[] = ['InProgress', 'InReview', 'Todo', 'Backlog'];

interface ProjectTabProps {
  onStartTimer: (note?: string) => void;
  onOpenProfile: () => void;
}

export function ProjectTab({ onStartTimer, onOpenProfile }: ProjectTabProps) {
  const { projects, board, selectedProjectId, loadProjects, selectProject, changeTaskStatus } = useData();
  const { meId } = useMembers();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await loadProjects();
    setRefreshing(false);
  };

  const data = board.data;
  const projectList = projects.data ?? [];

  const body = () => {
    if (!data && (projects.loading || board.loading)) return <LoadingState />;
    if (!data && (projects.error || board.error)) return <ErrorState message={projects.error ?? board.error ?? ''} onRetry={() => void loadProjects()} />;
    if (!data) {
      return (
        <View style={tw`items-center px-8 py-16`}>
          <FolderOpen size={28} color={colors.teal} />
          <Text style={tw`mt-2 font-bold text-cool-black`}>No active project</Text>
          <Text style={tw`text-center text-sm text-slate-500`}>When you’re staffed on a project, it shows up here.</Text>
        </View>
      );
    }

    const { project, tasks, epics } = data;
    const myTasks = tasks.filter((t) => t.assigneeIds.includes(meId) && t.status !== 'Cancelled');
    const focus = GROUP_ORDER.map((s) => myTasks.find((t) => t.status === s)).find(Boolean);
    const doneTasks = myTasks.filter((t) => t.status === 'Done');
    const openTasks = myTasks.filter((t) => !isClosed(t.status) && t.id !== focus?.id);
    const inReviewCount = tasks.filter((t) => t.status === 'InReview').length;
    const daysLeft = project.sprint ? differenceInCalendarDays(new Date(project.sprint.endDate), now()) : null;

    return (
      <>
        <ProjectHeader
          project={project}
          inReviewCount={inReviewCount}
          daysLeft={daysLeft}
          onStartTimer={() => onStartTimer(focus?.title)}
        />

        <FocusTaskCard task={focus} epic={epics.find((e) => e.id === focus?.epicId)} onOpen={setSelectedId} onChangeStatus={changeTaskStatus} />

        <View style={tw`px-4 pt-6`}>
          <View style={tw`flex-row items-baseline justify-between`}>
            <Eyebrow>Your other tasks</Eyebrow>
            <Text style={tw`text-xs text-slate-400`}>{openTasks.length} open</Text>
          </View>
          {openTasks.length === 0 ? (
            <View style={tw`mt-2 rounded-xl border border-slate-200 bg-white px-4 py-5`}>
              <Text style={tw`text-center text-sm text-slate-500`}>Nothing else on your plate this sprint.</Text>
            </View>
          ) : (
            <View style={tw`mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white`}>
              {GROUP_ORDER.flatMap((s) => openTasks.filter((t) => t.status === s)).map((t, i) => (
                <TaskRow key={t.id} task={t} first={i === 0} onOpen={() => setSelectedId(t.id)} />
              ))}
            </View>
          )}

          {doneTasks.length > 0 ? (
            <View style={tw`mt-3`}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showDone }}
                onPress={() => setShowDone((v) => !v)}
                style={tw`flex-row items-center gap-1.5 self-start py-1`}>
                <View style={[tw`h-2 w-2 rounded-full`, tw.style(STATUS_META.Done.dot)]} />
                <Text style={tw`text-sm font-bold text-navy`}>{doneTasks.length} completed</Text>
                <View style={showDone ? { transform: [{ rotate: '180deg' }] } : undefined}>
                  <ChevronDown size={16} color={colors.navy} />
                </View>
              </Pressable>
              {showDone ? (
                <View style={tw`mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white`}>
                  {doneTasks.map((t, i) => (
                    <TaskRow key={t.id} task={t} first={i === 0} onOpen={() => setSelectedId(t.id)} />
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </>
    );
  };

  return (
    <View style={tw`flex-1 bg-cool-white`}>
      <TopBar title="Project" onOpenProfile={onOpenProfile} />
      <ScrollView
        contentContainerStyle={tw`pb-8`}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.teal} colors={[colors.teal]} />}>
        {projectList.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={tw`gap-2 px-4 pt-4`}>
            {projectList.map((p) => {
              const active = p.id === selectedProjectId;
              return (
                <Pressable
                  key={p.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  onPress={() => void selectProject(p.id)}
                  style={[tw`rounded-full border px-3 py-1.5`, active ? tw`border-navy bg-navy` : tw`border-slate-200 bg-white`]}>
                  <Text style={[tw`text-sm font-bold`, active ? tw`text-white` : tw`text-navy`]}>{p.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
        {body()}
      </ScrollView>
      <TaskDetailSheet
        task={data?.tasks.find((t) => t.id === selectedId)}
        epics={data?.epics ?? []}
        onClose={() => setSelectedId(null)}
        onChangeStatus={changeTaskStatus}
      />
    </View>
  );
}
