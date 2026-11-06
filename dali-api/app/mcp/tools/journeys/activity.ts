import { McpInvalidError } from "../../errors";
import type { McpCtx, McpTool } from "../../registry";
import { SET_JOURNEY_LAB, SET_JOURNEY_QUIZ } from "./manage-content";
import { RULE_HELP, SET_JOURNEY_STUDIO_LAB } from "./manage-studio";
import { inputSchema } from "./shared";

type JsonProps = Record<string, Record<string, unknown>>;
const propsOf = (tool: McpTool) => (tool.def.inputSchema as { properties: JsonProps }).properties;

const ACTIVITIES = {
  code_lab: { tool: SET_JOURNEY_LAB, field: "codeLab", inner: "lab" },
  studio_lab: { tool: SET_JOURNEY_STUDIO_LAB, field: "studioLab", inner: "lab" },
  quiz: { tool: SET_JOURNEY_QUIZ, field: "quiz", inner: "quiz" },
} as const;
type Activity = keyof typeof ACTIVITIES;

export const SET_JOURNEY_ACTIVITY: McpTool = {
  def: {
    name: "set_journey_activity",
    description:
      "Set or remove a journey module's coding lab, whiteboard or document lab, or quiz. Pick it with activity, pass its content in the matching field, or pass remove: true to delete it. Each call replaces that whole activity and saves to the draft. A module has at most one lab, code or studio. " +
      "code_lab (codeLab): a small web project learners edit in the browser while guided steps check their work. files maps paths to contents and must include index.html (local stylesheets and scripts are inlined; <script type=\"module\"> files can import each other, and bare imports load from esm.sh). Each step's check is a JavaScript expression evaluated in the learner's page that is true once the step is done, e.g. document.querySelector('h1')?.textContent.includes('Hello'). " +
      `studio_lab (studioLab): a whiteboard (kind canvas) or document (kind document) lab for non-code work like critiques, affinity maps and ticket writing. Each criterion is checked automatically (mode auto, with a rule), ticked by the learner (self), or approved by a journey owner or editor after the learner submits (mentor). ${RULE_HELP} Canvas labs take a starter board: items {type: sticky|text|shape|image|pin, x, y, width?, height?, text?, color: yellow|pink|green|blue|purple, src?, alt?, locked?} and hidden hotspots {label, x, y, width, height} learners should pin. Document labs take a starter template in Markdown (use ### headings for the sections rules look for). ` +
      "quiz (quiz): learners must reach passingScore (percent correct) to finish the module, and can retry. multiple-choice questions take options (strings) and correctOption (0-based index); short-answer questions take acceptedAnswers, matched ignoring case, extra spaces and trailing punctuation (leave it empty to accept any response, for reflection questions).",
    inputSchema: inputSchema({
      type: "object" as const,
      properties: {
        activity: { type: "string", enum: Object.keys(ACTIVITIES) },
        journeyId: { type: "string", minLength: 1 },
        moduleId: { type: "string", minLength: 1 },
        remove: { type: "boolean" },
        codeLab: propsOf(SET_JOURNEY_LAB).lab,
        studioLab: propsOf(SET_JOURNEY_STUDIO_LAB).lab,
        quiz: propsOf(SET_JOURNEY_QUIZ).quiz,
      },
      required: ["activity", "journeyId", "moduleId"],
      additionalProperties: false,
    }),
    requiredScope: "mcp:write",
  },
  run: async (ctx: McpCtx, raw) => {
    const args = raw as Record<string, unknown> & { activity: Activity; journeyId: string; moduleId: string; remove?: boolean };
    const target = ACTIVITIES[args.activity];
    if (!target) throw new McpInvalidError(`Unknown activity '${args.activity}'`);
    const content = args[target.field];
    if (!args.remove && content === undefined) throw new McpInvalidError(`Pass ${target.field}, or remove: true.`);
    return target.tool.run(ctx, {
      journeyId: args.journeyId,
      moduleId: args.moduleId,
      ...(args.remove ? { remove: true } : { [target.inner]: content }),
    });
  },
};
