import React, { useEffect, useState } from 'react';
import { startOfWeek } from 'date-fns';
import { useData } from '../../contexts/DataContext';
import { useNotes } from '../../contexts/NotesContext';
import { useTime } from '../../contexts/TimeContext';
import { LoadingScreen } from '../brand/LoadingScreen';

const SYNC_MESSAGES = ['Syncing your timesheet', 'Pulling your tasks', 'Loading meetings and notes', 'Preparing your pass'];

export function SyncingScreen({ onDone }: { onDone: () => void }) {
  const { load: loadTime } = useTime();
  const { load: loadNotes } = useNotes();
  const { loadMe, loadProjects, loadWeek, loadPass } = useData();
  const [done, setDone] = useState(0);

  useEffect(() => {
    let alive = true;
    const step = (p: Promise<void>) => p.finally(() => alive && setDone((d) => d + 1));
    void Promise.all([
      step(Promise.all([loadMe(), loadTime()]).then(() => {})),
      step(loadProjects()),
      step(Promise.all([loadWeek(startOfWeek(new Date())), loadNotes()]).then(() => {})),
      step(loadPass()),
    ]);
    return () => {
      alive = false;
    };
  }, [loadTime, loadNotes, loadMe, loadProjects, loadWeek, loadPass]);

  const progress = Math.round((done / SYNC_MESSAGES.length) * 100);

  useEffect(() => {
    if (progress < 100) return;
    const id = setTimeout(onDone, 350);
    return () => clearTimeout(id);
  }, [progress, onDone]);

  return <LoadingScreen messages={SYNC_MESSAGES} messageInterval={650} progress={progress} footer="Syncing with DALI OS" />;
}
