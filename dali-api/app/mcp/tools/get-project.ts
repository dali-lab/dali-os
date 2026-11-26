import { McpInvalidError } from "../errors";
import { runGetProjectOverview } from "./get-project-overview";
import { runGetProjectSettings } from "./project-settings";
import { runGetProjectShowcase } from "./project-showcase";

const PARTS = ["overview", "settings", "showcase"] as const;
type Part = (typeof PARTS)[number];

export const GET_PROJECT_TOOL = {
  name: "get_project",
  description:
    "Read one project, as the project page shows it. include picks the parts: overview (default) is status, current-term roster (plus past rosters with terms), active sprint, current epic and task counts; settings is terms, domains, per-term scopes, repos, Figma files and Slack/GitHub/Google identities (no payroll chart strings); showcase is the public dali.website card. Each part comes back under its own key.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: {
        type: "string",
        minLength: 1,
        description: "Project.id, as returned by `list_projects`.",
      },
      include: {
        type: "array",
        items: { type: "string", enum: [...PARTS] },
        minItems: 1,
        description: "Parts to return. Default: overview.",
      },
      terms: {
        type: "array",
        items: { type: "string", minLength: 1 },
        minItems: 1,
        maxItems: 20,
        description:
          "Term codes (e.g. 22F) whose rosters the overview adds under rostersByTerm, one key per code; a term with no one staffed is an empty list. Pass the project's termCodes for its full staffing history.",
      },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { projectId: string; include?: Part[]; terms?: string[] };

export async function runGetProject(callerId: string, input: Input) {
  const include = new Set<Part>(input.include?.length ? input.include : ["overview"]);
  const { projectId, terms } = input;
  if (terms?.length && !include.has("overview")) {
    throw new McpInvalidError("terms adds rosters to the overview; include overview to use it.");
  }
  const [overview, settings, showcase] = await Promise.all([
    include.has("overview") ? runGetProjectOverview({ projectId, terms }) : undefined,
    include.has("settings") ? runGetProjectSettings(callerId, { projectId }) : undefined,
    include.has("showcase") ? runGetProjectShowcase(callerId, { projectId }) : undefined,
  ]);
  return {
    ...(overview && { overview }),
    ...(settings && { settings }),
    ...(showcase && { showcase }),
  };
}
