import type { TaskStatus } from '../types/project';

export const TASK_STATUSES: TaskStatus[] = ['Backlog', 'Todo', 'InProgress', 'InReview', 'Done', 'Cancelled'];

interface StatusMeta {
  label: string;
  dot: string;
  soft: string;
  text: string;
}

export const STATUS_META: Record<TaskStatus, StatusMeta> = {
  Backlog: { label: 'Backlog', dot: 'bg-medium-gray', soft: 'bg-slate-100', text: 'text-slate-600' },
  Todo: { label: 'To do', dot: 'bg-navy', soft: 'bg-pale-blue', text: 'text-navy' },
  InProgress: { label: 'In progress', dot: 'bg-teal', soft: 'bg-[#DDF4F4]', text: 'text-[#137A7A]' },
  InReview: { label: 'In review', dot: 'bg-yellow', soft: 'bg-light-yellow', text: 'text-dark-navy' },
  Done: { label: 'Done', dot: 'bg-green', soft: 'bg-[#E3F2EC]', text: 'text-[#2F7A5F]' },
  Cancelled: { label: 'Cancelled', dot: 'bg-slate-300', soft: 'bg-slate-100', text: 'text-slate-500' },
};

const NEXT_STEP: Record<TaskStatus, { status: TaskStatus; label: string } | null> = {
  Backlog: { status: 'Todo', label: 'Move to To do' },
  Todo: { status: 'InProgress', label: 'Start task' },
  InProgress: { status: 'InReview', label: 'Send to review' },
  InReview: { status: 'Done', label: 'Mark as done' },
  Done: null,
  Cancelled: null,
};

export function nextStep(status: TaskStatus) {
  return NEXT_STEP[status];
}

export function isClosed(status: TaskStatus) {
  return status === 'Done' || status === 'Cancelled';
}
