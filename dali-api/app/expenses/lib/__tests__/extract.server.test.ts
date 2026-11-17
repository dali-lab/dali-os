import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
const aiProvidersFor = vi.fn();
const claimAiQuota = vi.fn();
const recordTokenUsage = vi.fn();

vi.mock("~/lib/ai.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/ai.server")>()),
  aiProvidersFor: (...a: unknown[]) => aiProvidersFor(...a),
}));
vi.mock("~/lib/ai-quota.server", () => ({ claimAiQuota: (...a: unknown[]) => claimAiQuota(...a) }));
vi.mock("~/lib/ai-usage.server", () => ({ recordTokenUsage: (...a: unknown[]) => recordTokenUsage(...a) }));

import { emptyExtraction, extractReceipts } from "../extract.server";

const png = { contentType: "image/png" as const, bytes: new Uint8Array([1, 2, 3]) };
const pdf = { contentType: "application/pdf" as const, bytes: new Uint8Array([0x25, 0x50]) };

const toolReply = (input: unknown, usage = { input_tokens: 900, output_tokens: 300 }) => ({
  content: [{ type: "tool_use", name: "record_receipts", input }],
  usage,
});

const RESULT = {
  receipts: [
    {
      index: 0,
      kind: "PAYMENT_PROOF",
      merchant: "Gnomon Copy",
      date: "2026-11-17",
      invoiceNumbers: [],
      lineItems: [{ description: "INV #75085", qty: 1, amount: 13.81 }],
      total: 36.87,
      cardLast4: "4821",
      confidence: { total: 0.9 },
    },
    { index: 1, kind: "ITEMIZED", invoiceNumbers: ["75085"], poRef: "Technigala Nov 26 part3", subtotal: 13.81, tax: 0, tip: 0.1, total: 13.81 },
  ],
  expense: { merchant: "Gnomon Copy", date: "2026-11-17", amountCharged: 36.87, purpose: "Technigala printing", teamMeal: false, cardLast4: "4821" },
};

beforeEach(() => {
  vi.clearAllMocks();
  aiProvidersFor.mockReturnValue([{ name: "anthropic", client: { messages: { create } } }]);
  claimAiQuota.mockResolvedValue({ ok: true, day: "2026-11-17", used: 1 });
});

describe("extractReceipts", () => {
  it("sends image and document blocks on the receiptExtract task, and reads the tool result in cents", async () => {
    create.mockResolvedValue(toolReply(RESULT));
    const out = await extractReceipts("u1", [png, pdf]);

    const req = create.mock.calls[0][0];
    expect(aiProvidersFor).toHaveBeenCalledWith("receiptExtract");
    expect(req.model).toBe("claude-sonnet-5-5");
    expect(req.output_config).toEqual({ effort: "low" });
    expect(req.tool_choice).toEqual({ type: "auto" });
    expect(req.tools.map((tool: { name: string }) => tool.name)).toEqual(["record_receipts"]);
    const blocks = req.messages[0].content.map((b: { type: string }) => b.type);
    expect(blocks).toEqual(["text", "image", "text", "document", "text"]);
    expect(req.messages[0].content[1].source).toMatchObject({ type: "base64", media_type: "image/png", data: "AQID" });
    expect(req.messages[0].content[3].source.media_type).toBe("application/pdf");

    expect(out.error).toBeNull();
    expect(out.receipts[0]).toMatchObject({
      kind: "PAYMENT_PROOF",
      merchant: "Gnomon Copy",
      date: "2026-11-17",
      totalCents: 3687,
      cardLast4: "4821",
      confidence: { total: 0.9 },
      lineItems: [{ description: "INV #75085", qty: 1, amountCents: 1381 }],
    });
    expect(out.receipts[1]).toMatchObject({ kind: "ITEMIZED", poRef: "Technigala Nov 26 part3", tipCents: 10, merchant: null });
    expect(out.expense).toEqual({
      merchant: "Gnomon Copy",
      purchasedAt: "2026-11-17",
      amountChargedCents: 3687,
      purpose: "Technigala printing",
      teamMeal: false,
      cardLast4: "4821",
    });
  });

  it("claims one quota and records one usage entry for the whole expense", async () => {
    create.mockResolvedValue(toolReply(RESULT));
    await extractReceipts("u1", [png, png, png]);
    expect(claimAiQuota).toHaveBeenCalledTimes(1);
    expect(claimAiQuota).toHaveBeenCalledWith("u1");
    expect(create).toHaveBeenCalledTimes(1);
    expect(recordTokenUsage).toHaveBeenCalledTimes(1);
    expect(recordTokenUsage).toHaveBeenCalledWith("u1", "2026-11-17", 900, 300);
  });

  it("tolerates junk fields and drops out-of-range entries", async () => {
    create.mockResolvedValue(
      toolReply({
        receipts: [{ index: 0, kind: "WEIRD", total: "12", date: "Nov 17", lineItems: "none" }, { index: 9, kind: "ITEMIZED" }],
        expense: { amountCharged: "x", teamMeal: "yes" },
      }),
    );
    const out = await extractReceipts("u1", [png]);
    expect(out.receipts).toHaveLength(1);
    expect(out.receipts[0]).toMatchObject({ kind: "OTHER", totalCents: null, date: null, lineItems: [] });
    expect(out.expense.amountChargedCents).toBeNull();
    expect(out.expense.teamMeal).toBe(false);
    expect(out.error).toBeNull();
  });

  it("returns an empty extraction and logs the stop reason when the model skips the tool", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    create.mockResolvedValue({
      content: [{ type: "text", text: "sorry" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 1 },
    });
    expect(await extractReceipts("u1", [png, png])).toEqual(emptyExtraction(2, "failed"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[expenses:extract]"), "end_turn");
    log.mockRestore();
  });

  it("returns an empty extraction and logs the API error message when the model call throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    create.mockRejectedValue(new Error('400 tool_choice: type "tool" and "any" are not supported for this model.'));
    await expect(extractReceipts("u1", [png])).resolves.toEqual(emptyExtraction(1, "failed"));
    expect(recordTokenUsage).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("[expenses:extract]"),
      '400 tool_choice: type "tool" and "any" are not supported for this model.',
    );
    log.mockRestore();
  });

  it("returns an empty extraction without a provider", async () => {
    aiProvidersFor.mockReturnValue([]);
    expect(await extractReceipts("u1", [png])).toEqual(emptyExtraction(1, "no_provider"));
    expect(claimAiQuota).not.toHaveBeenCalled();
  });

  it("returns an empty extraction over quota, without calling the model", async () => {
    claimAiQuota.mockResolvedValue({ ok: false, error: "limit", retryAfterSeconds: 10 });
    expect(await extractReceipts("u1", [png])).toEqual(emptyExtraction(1, "quota"));
    expect(create).not.toHaveBeenCalled();
  });

  it("does nothing for no images", async () => {
    expect(await extractReceipts("u1", [])).toEqual(emptyExtraction(0));
    expect(claimAiQuota).not.toHaveBeenCalled();
  });
});
