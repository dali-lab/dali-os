import type { ProjectBoardResponse } from '../api/contract';

export type { Epic, Task, TaskStatus, ProjectSummary } from '../api/contract';
export type Project = ProjectBoardResponse['project'];
