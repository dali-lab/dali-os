// Pure edits on a journey draft. Every function returns a new value and leaves
// its input untouched, so the editor can hand them straight to setState.

import type {
  Journey,
  JourneyContent,
  JourneyModule,
  Lab,
  LabStep,
  LessonPage,
  Quiz,
  QuizQuestion,
  QuizQuestionType,
  RichDoc,
} from "./types";
import { createId } from "~/lib/short-id";

export { createId } from "~/lib/short-id";
export { changeSlideLayout, createSlide, duplicateSlide, moveItem } from "~/components/slides/slide-edit";

export function updateModule<J extends Pick<Journey, "modules">>(
  journey: J,
  moduleId: string,
  fn: (m: JourneyModule) => JourneyModule,
): J {
  return { ...journey, modules: journey.modules.map((m) => (m.id === moduleId ? fn(m) : m)) };
}

export function removeModule<J extends Pick<Journey, "modules">>(journey: J, moduleId: string): J {
  return {
    ...journey,
    modules: journey.modules
      .filter((m) => m.id !== moduleId)
      .map((m) => ({ ...m, dependsOn: m.dependsOn.filter((d) => d !== moduleId) })),
  };
}

/** True when `moduleId` depends on `targetId`, directly or through other modules. */
export function dependsOnTransitively(journey: Pick<Journey, "modules">, moduleId: string, targetId: string): boolean {
  const seen = new Set<string>();
  const stack = [moduleId];
  while (stack.length) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const mod = journey.modules.find((m) => m.id === id);
    if (!mod) continue;
    for (const dep of mod.dependsOn) {
      if (dep === targetId) return true;
      stack.push(dep);
    }
  }
  return false;
}

export function canAddDependency(journey: Pick<Journey, "modules">, moduleId: string, prereqId: string): boolean {
  if (moduleId === prereqId) return false;
  const mod = journey.modules.find((m) => m.id === moduleId);
  if (!mod || mod.dependsOn.includes(prereqId)) return false;
  if (!journey.modules.some((m) => m.id === prereqId)) return false;
  return !dependsOnTransitively(journey, prereqId, moduleId);
}

export function addDependency<J extends Pick<Journey, "modules">>(journey: J, moduleId: string, prereqId: string): J {
  if (!canAddDependency(journey, moduleId, prereqId)) return journey;
  return updateModule(journey, moduleId, (m) => ({ ...m, dependsOn: [...m.dependsOn, prereqId] }));
}

export function removeDependency<J extends Pick<Journey, "modules">>(journey: J, moduleId: string, prereqId: string): J {
  return updateModule(journey, moduleId, (m) => ({ ...m, dependsOn: m.dependsOn.filter((d) => d !== prereqId) }));
}

export function emptyDoc(): RichDoc {
  return [];
}

export function createPage(): LessonPage {
  return { id: createId("page"), title: "New page", content: emptyDoc() };
}

export const MODULE_SPACING = { x: 360, y: 140 };

export function createModule(journey: Pick<Journey, "modules">, parentId: string | null): JourneyModule {
  const parent = parentId ? journey.modules.find((m) => m.id === parentId) : undefined;
  let position = { x: 0, y: 150 };
  if (parent) {
    const siblings = journey.modules.filter((m) => m.dependsOn.includes(parent.id)).length;
    position = { x: parent.position.x + MODULE_SPACING.x, y: parent.position.y + siblings * MODULE_SPACING.y };
  } else if (journey.modules.length) {
    position = { x: Math.max(...journey.modules.map((m) => m.position.x)) + MODULE_SPACING.x, y: 150 };
  }
  return {
    id: createId("mod"),
    title: "Untitled module",
    summary: "",
    duration: "20 min",
    dependsOn: parent ? [parent.id] : [],
    position,
    pages: [createPage()],
  };
}

export function createJourneyContent(): JourneyContent {
  const base: JourneyContent = { title: "Untitled journey", description: "", modules: [] };
  return { ...base, modules: [{ ...createModule(base, null), title: "Welcome" }] };
}

export function createStep(): LabStep {
  return { id: createId("step"), title: "New step", instructions: "", check: "" };
}

export function createLab(): Lab {
  return {
    title: "New lab",
    intro: "",
    defaultFile: "src/main.js",
    files: {
      "index.html": [
        "<!doctype html>",
        "<html>",
        "  <head>",
        '    <link rel="stylesheet" href="styles/main.css" />',
        "  </head>",
        "  <body>",
        '    <main id="app"></main>',
        '    <script type="module" src="src/main.js"></script>',
        "  </body>",
        "</html>",
      ].join("\n"),
      "styles/main.css": "body {\n  font-family: system-ui, sans-serif;\n  padding: 32px;\n  color: #082330;\n}",
      "src/main.js":
        "import { greet } from './utils/greet.js';\n\ndocument.querySelector('#app').innerHTML = '<h1>' + greet('DALI') + '</h1>';\n",
      "src/utils/greet.js": "export function greet(name) {\n  return 'Hello, ' + name + '!';\n}\n",
    },
    steps: [
      {
        id: createId("step"),
        title: "New step",
        instructions: "Describe what the learner should change.",
        check: "document.querySelector('h1')?.textContent.includes('Hello')",
      },
    ],
  };
}

export function createQuestion(
  type: QuizQuestionType,
  base?: Pick<QuizQuestion, "prompt" | "explanation">,
): QuizQuestion {
  const prompt = base?.prompt ?? "";
  const explanation = base?.explanation;
  if (type === "multiple-choice") {
    const options = [0, 1, 2].map(() => ({ id: createId("opt"), text: "" }));
    return { id: createId("q"), type, prompt, explanation, options, correctOptionId: options[0].id };
  }
  return { id: createId("q"), type, prompt, explanation, acceptedAnswers: [""] };
}

/** Switches a question's type, keeping its id, prompt and explanation. */
export function changeQuestionType(question: QuizQuestion, type: QuizQuestionType): QuizQuestion {
  if (question.type === type) return question;
  return { ...createQuestion(type, question), id: question.id };
}

export function createQuiz(): Quiz {
  return { title: "Check your understanding", intro: "", passingScore: 80, questions: [createQuestion("multiple-choice")] };
}

