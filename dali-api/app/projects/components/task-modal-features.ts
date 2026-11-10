export type TaskModalFeatures = { epics: boolean; stories: boolean };

export const CORE_TASK_MODAL_FEATURES: TaskModalFeatures = { epics: false, stories: false };

const DEFAULT_TASK_MODAL_FEATURES: TaskModalFeatures = { epics: true, stories: true };

export function resolveTaskModalFeatures(features?: Partial<TaskModalFeatures>): TaskModalFeatures {
  return { ...DEFAULT_TASK_MODAL_FEATURES, ...features };
}
