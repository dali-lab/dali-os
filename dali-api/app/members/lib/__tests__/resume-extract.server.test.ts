import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
const resolveAiProvider = vi.fn();
vi.mock("~/lib/ai.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/ai.server")>()),
  resolveAiProvider: () => resolveAiProvider(),
}));

import { ResumeProviderMissingError, extractJobsFromPdf } from "~/members/lib/resume-extract.server";

const JOBS = {
  jobs: [
    {
      company: " Acme ",
      position: "Engineer",
      description: null,
      location: "NYC",
      workMode: "Remote",
      start: { year: 2020, month: 4 },
      end: null,
      current: true,
    },
  ],
};

const reply = (text: string, usage = { input_tokens: 120, output_tokens: 45 }) => ({
  content: [{ type: "text", text }],
  usage,
});

beforeEach(() => {
  vi.clearAllMocks();
  resolveAiProvider.mockReturnValue({ client: { messages: { create } }, sonnetModel: "sonnet-test" });
});

describe("extractJobsFromPdf", () => {
  it("sends the PDF as a base64 document block on the sonnet model", async () => {
    create.mockResolvedValue(reply(JSON.stringify(JOBS)));
    await extractJobsFromPdf(new Uint8Array([0x25, 0x50, 0x44, 0x46]));

    const request = create.mock.calls[0][0];
    expect(request.model).toBe("sonnet-test");
    expect(request.max_tokens).toBe(4096);
    expect(request.thinking).toBeUndefined();
    const doc = request.messages[0].content.find((b: { type: string }) => b.type === "document");
    expect(doc.source).toEqual({
      type: "base64",
      media_type: "application/pdf",
      data: Buffer.from([0x25, 0x50, 0x44, 0x46]).toString("base64"),
    });
  });

  it("parses a fenced JSON response into normalized jobs", async () => {
    create.mockResolvedValue(reply("```json\n" + JSON.stringify(JOBS) + "\n```"));
    const { jobs } = await extractJobsFromPdf(new Uint8Array([1]));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      company: "Acme",
      position: "Engineer",
      workMode: "Remote",
      startMonth: "2020-04",
      current: true,
    });
  });

  it("throws on malformed JSON", async () => {
    create.mockResolvedValue(reply("Here are the jobs: not json"));
    await expect(extractJobsFromPdf(new Uint8Array([1]))).rejects.toThrow();
  });

  it("throws when the JSON does not match the schema", async () => {
    create.mockResolvedValue(reply(JSON.stringify({ jobs: "nope" })));
    await expect(extractJobsFromPdf(new Uint8Array([1]))).rejects.toThrow();
  });

  it("returns the token counts", async () => {
    create.mockResolvedValue(reply(JSON.stringify(JOBS)));
    const result = await extractJobsFromPdf(new Uint8Array([1]));
    expect(result).toMatchObject({ inputTokens: 120, outputTokens: 45 });
  });

  it("throws ResumeProviderMissingError without a provider", async () => {
    resolveAiProvider.mockReturnValue(null);
    await expect(extractJobsFromPdf(new Uint8Array([1]))).rejects.toBeInstanceOf(ResumeProviderMissingError);
  });
});
