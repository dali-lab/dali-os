import React, { useEffect, useState } from 'react';
import { startOfWeek } from 'date-fns';
import { useChat } from '../../contexts/ChatContext';
import { useData } from '../../contexts/DataContext';
import { LoadingScreen } from '../brand/LoadingScreen';

const SYNC_MESSAGES = ['Syncing your channels', 'Pulling your tasks', 'Loading your calendar', 'Preparing your pass'];

export function SyncingScreen({ onDone }: { onDone: () => void }) {
  const { refresh } = useChat();
  const { loadMe, loadProjects, loadWeek, loadPass } = useData();
  const [done, setDone] = useState(0);

  useEffect(() => {
    let alive = true;
    const step = (p: Promise<void>) => p.finally(() => alive && setDone((d) => d + 1));
    void Promise.all([
      step(refresh()),
      step(Promise.all([loadMe(), loadProjects()]).then(() => {})),
      step(loadWeek(startOfWeek(new Date()))),
      step(loadPass()),
    ]);
    return () => {
      alive = false;
    };
  }, [refresh, loadMe, loadProjects, loadWeek, loadPass]);

  const progress = Math.round((done / SYNC_MESSAGES.length) * 100);

  useEffect(() => {
    if (progress < 100) return;
    const id = setTimeout(onDone, 350);
    return () => clearTimeout(id);
  }, [progress, onDone]);

  return <LoadingScreen messages={SYNC_MESSAGES} messageInterval={650} progress={progress} footer="Syncing with DALI OS" />;
}
