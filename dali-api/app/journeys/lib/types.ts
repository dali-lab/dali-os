// Journey content as stored in OnboardingJourney.draft / .published. Pure
// types, safe to import from client and server code alike.

import type { RichDoc, Slide } from "~/components/slides/types";
import type { StudioLab } from "./studio-types";

export type { RichDoc, Slide, SlideImage, SlideLayout } from "~/components/slides/types";

export type ModuleStatus = "completed" | "available" | "locked";

export interface LessonPage {
  id: string;
  title: string;
  content: RichDoc;
}

/** A lab's files keyed by path, e.g. "index.html" or "src/components/Card.js". */
export type LabFiles = Record<string, string>;

export interface LabStep {
  id: string;
  title: string;
  instructions: string;
  hint?: string;
  /** A JavaScript expression evaluated inside the learner's page; true when the step is done. */
  check: string;
}

export interface Lab {
  title: string;
  intro: string;
  files: LabFiles;
  /** The file opened first in the editor. */
  defaultFile?: string;
  steps: LabStep[];
}

export interface QuizOption {
  id: string;
  text: string;
}

export interface MultipleChoiceQuestion {
  id: string;
  type: "multiple-choice";
  prompt: string;
  options: QuizOption[];
  correctOptionId: string;
  explanation?: string;
}

export interface ShortAnswerQuestion {
  id: string;
  type: "short-answer";
  prompt: string;
  /** No non-empty entries means any response is accepted (a reflection question). */
  acceptedAnswers: string[];
  explanation?: string;
}

export type QuizQuestion = MultipleChoiceQuestion | ShortAnswerQuestion;
export type QuizQuestionType = QuizQuestion["type"];

export interface Quiz {
  title: string;
  intro: string;
  /** Percent of questions that must be correct, 0 to 100. */
  passingScore: number;
  questions: QuizQuestion[];
}

export interface Point {
  x: number;
  y: number;
}

export interface JourneyModule {
  id: string;
  title: string;
  summary: string;
  duration: string;
  dependsOn: string[];
  position: Point;
  pages: LessonPage[];
  slides?: Slide[];
  /** A code lab. A module has this or `studio`, not both. */
  lab?: Lab;
  /** A whiteboard or document lab. */
  studio?: StudioLab;
  quiz?: Quiz;
}

export interface JourneyContent {
  title: string;
  description: string;
  recommended?: boolean;
  modules: JourneyModule[];
}

/** A journey's content with the row id it belongs to. */
export interface Journey extends JourneyContent {
  id: string;
}

export interface ConsoleEntry {
  id: number;
  level: "log" | "info" | "warn" | "error";
  text: string;
}

export type JourneyRole = "owner" | "editor";

/** A domain tab: Domain.code lower-cased for the URL, plus its display name. */
export interface JourneyDomain {
  slug: string;
  name: string;
}
