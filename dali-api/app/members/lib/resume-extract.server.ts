import { z } from "zod";
import { resolveAiProvider, stripJsonFences } from "~/lib/ai.server";
import { toImportedJobs, type ImportedJob } from "./work-history-import";

const SYSTEM_PROMPT = `You extract work history from a resume or a LinkedIn profile PDF.

Rules, all mandatory:
- Count jobs, internships, research roles and teaching assistant roles. Skip education, clubs, projects and skills unless they are a role at an organization.
- When one company lists several titles, return one job per title.
- Use null rather than guessing. Never invent a month.
- Copy descriptions as written.
- Put the newest job first.
- Respond with ONLY a single JSON object shaped exactly like: {"jobs":[{"company","position","description","location","workMode":"OnSite"|"Hybrid"|"Remote"|null,"start":{"year":number,"month":1-12|null},"end":{"year":number,"month":1-12|null}|null,"current":boolean}]}. No markdown code fences, no commentary, no preamble.`;

const DateSchema = z.object({ year: z.number().nullable(), month: z.number().nullable() }).nullable();

const ResponseSchema = z.object({
  jobs: z.array(
    z.object({
      company: z.string().nullable(),
      position: z.string().nullable(),
      description: z.string().nullable().optional(),
      location: z.string().nullable().optional(),
      workMode: z.string().nullable().optional(),
      start: DateSchema.optional(),
      end: DateSchema.optional(),
      current: z.boolean().nullable().optional(),
    }),
  ),
});

export class ResumeProviderMissingError extends Error {
  constructor() {
    super("No AI provider configured");
    this.name = "ResumeProviderMissingError";
  }
}

/** Never log the PDF, the prompt or the model output. */
export async function extractJobsFromPdf(
  pdf: Uint8Array,
): Promise<{ jobs: ImportedJob[]; inputTokens: number; outputTokens: number }> {
  const provider = resolveAiProvider();
  if (!provider) throw new ResumeProviderMissingError();

  const message = await provider.client.messages.create({
    model: provider.sonnetModel,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: Buffer.from(pdf).toString("base64") },
          },
          { type: "text", text: "Extract the work history from this document." },
        ],
      },
    ],
    stream: false,
  });

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { type: "text"; text: string }).text)
    .join("\n");
  const parsed = ResponseSchema.parse(JSON.parse(stripJsonFences(text)));

  return {
    jobs: toImportedJobs(parsed.jobs.map((j) => ({ ...j, current: j.current === true }))),
    inputTokens: message.usage?.input_tokens ?? 0,
    outputTokens: message.usage?.output_tokens ?? 0,
  };
}
