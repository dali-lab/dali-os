import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { claimAiQuota } from "~/lib/ai-quota.server";
import { recordTokenUsage } from "~/lib/ai-usage.server";
import { aiProvidersFor, modelParams } from "~/lib/ai.server";
import { dollarsToCents } from "./money";
import type { ReceiptContentType } from "./receipts.server";

export type ReceiptImageInput = { contentType: ReceiptContentType; bytes: Uint8Array };

export type ExtractedLine = { description: string; qty: number | null; amountCents: number | null };

export type ExtractedReceipt = {
  kind: "PAYMENT_PROOF" | "ITEMIZED" | "OTHER";
  merchant: string | null;
  merchantAddress: string | null;
  date: string | null;
  time: string | null;
  invoiceNumbers: string[];
  poRef: string | null;
  lineItems: ExtractedLine[];
  subtotalCents: number | null;
  taxCents: number | null;
  tipCents: number | null;
  totalCents: number | null;
  currency: string | null;
  paymentMethod: string | null;
  cardLast4: string | null;
  confidence: Record<string, number>;
};

export type ExpenseSummary = {
  merchant: string | null;
  purchasedAt: string | null;
  amountChargedCents: number | null;
  purpose: string | null;
  teamMeal: boolean;
  cardLast4: string | null;
};

export type ReceiptExtraction = {
  receipts: ExtractedReceipt[];
  expense: ExpenseSummary;
  error: "no_provider" | "quota" | "failed" | null;
};

export function emptyReceipt(): ExtractedReceipt {
  return {
    kind: "OTHER",
    merchant: null,
    merchantAddress: null,
    date: null,
    time: null,
    invoiceNumbers: [],
    poRef: null,
    lineItems: [],
    subtotalCents: null,
    taxCents: null,
    tipCents: null,
    totalCents: null,
    currency: null,
    paymentMethod: null,
    cardLast4: null,
    confidence: {},
  };
}

export function emptyExtraction(count: number, error: ReceiptExtraction["error"] = null): ReceiptExtraction {
  return {
    receipts: Array.from({ length: count }, emptyReceipt),
    expense: {
      merchant: null,
      purchasedAt: null,
      amountChargedCents: null,
      purpose: null,
      teamMeal: false,
      cardLast4: null,
    },
    error,
  };
}

const TOOL_NAME = "record_receipts";

const str = z.string().nullable().catch(null);
const money = z.number().nullable().catch(null);

const ReceiptSchema = z.object({
  index: z.number().int().catch(-1),
  kind: z.enum(["PAYMENT_PROOF", "ITEMIZED", "OTHER"]).catch("OTHER"),
  merchant: str,
  merchantAddress: str,
  date: str,
  time: str,
  invoiceNumbers: z.array(z.string()).catch([]),
  poRef: str,
  lineItems: z
    .array(z.object({ description: z.string().catch(""), qty: z.number().nullable().catch(null), amount: money }))
    .catch([]),
  subtotal: money,
  tax: money,
  tip: money,
  total: money,
  currency: str,
  paymentMethod: str,
  cardLast4: str,
  confidence: z.record(z.string(), z.number()).catch({}),
});

const ResultSchema = z.object({
  receipts: z.array(ReceiptSchema),
  expense: z.object({
    merchant: str,
    date: str,
    amountCharged: money,
    purpose: str,
    teamMeal: z.boolean().catch(false),
    cardLast4: str,
  }),
});

const nullableNumber = { type: ["number", "null"] } as const;
const nullableString = { type: ["string", "null"] } as const;

const TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: "Record what the receipt images show.",
  input_schema: {
    type: "object",
    required: ["receipts", "expense"],
    properties: {
      receipts: {
        type: "array",
        items: {
          type: "object",
          required: ["index", "kind"],
          properties: {
            index: { type: "integer", description: "0-based position of the image." },
            kind: { type: "string", enum: ["PAYMENT_PROOF", "ITEMIZED", "OTHER"] },
            merchant: nullableString,
            merchantAddress: nullableString,
            date: { ...nullableString, description: "YYYY-MM-DD" },
            time: { ...nullableString, description: "HH:MM, 24-hour" },
            invoiceNumbers: { type: "array", items: { type: "string" } },
            poRef: nullableString,
            lineItems: {
              type: "array",
              items: {
                type: "object",
                required: ["description"],
                properties: { description: { type: "string" }, qty: nullableNumber, amount: nullableNumber },
              },
            },
            subtotal: nullableNumber,
            tax: nullableNumber,
            tip: nullableNumber,
            total: nullableNumber,
            currency: nullableString,
            paymentMethod: nullableString,
            cardLast4: nullableString,
            confidence: {
              type: "object",
              description: "0 to 1 per field name, for any field you are unsure of.",
              additionalProperties: { type: "number" },
            },
          },
        },
      },
      expense: {
        type: "object",
        required: ["amountCharged"],
        properties: {
          merchant: nullableString,
          date: { ...nullableString, description: "YYYY-MM-DD" },
          amountCharged: { ...nullableNumber, description: "What was actually charged, from the payment proof when there is one." },
          purpose: { ...nullableString, description: "One short plain sentence on what was bought and why, only if the receipts say." },
          teamMeal: { type: "boolean", description: "True for food for a group." },
          cardLast4: nullableString,
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You read receipts, invoices and card slips for an expense report. The images are one purchase.

Rules, all mandatory:
- Classify each image: PAYMENT_PROOF (card slip or payment confirmation), ITEMIZED (register receipt, invoice or bill with line items), or OTHER. A register receipt that lists items and shows payment is ITEMIZED.
- Never assume a layout. Photos can be skewed, partial or crumpled.
- Use null rather than guessing. Never invent a value.
- Amounts are plain numbers in dollars, with a minus sign for negatives. Keep lines you cannot explain; do not change totals to fit them.
- The amount charged comes from the payment proof when there is one, otherwise from the receipt total including tip.
- Put purchase order or reference text in poRef exactly as written.
- Call ${TOOL_NAME} once, with one entry per image in order.`;

function toIso(date: string | null): string | null {
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

const cents = (n: number | null) => (n === null ? null : dollarsToCents(n));

function toBlock(image: ReceiptImageInput): Anthropic.ContentBlockParam {
  const data = Buffer.from(image.bytes).toString("base64");
  if (image.contentType === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  }
  return { type: "image", source: { type: "base64", media_type: image.contentType, data } };
}

export async function extractReceipts(userId: string, images: ReceiptImageInput[]): Promise<ReceiptExtraction> {
  const empty = (error: ReceiptExtraction["error"]) => emptyExtraction(images.length, error);
  if (images.length === 0) return empty(null);

  try {
    const [provider] = aiProvidersFor("receiptExtract");
    if (!provider) return empty("no_provider");

    const quota = await claimAiQuota(userId);
    if (!quota.ok) return empty("quota");

    const content: Anthropic.ContentBlockParam[] = [];
    images.forEach((image, i) => {
      content.push({ type: "text", text: `Image ${i}:` }, toBlock(image));
    });
    content.push({ type: "text", text: "Read these receipts." });

    const message = await provider.client.messages.create({
      ...modelParams(provider, "receiptExtract"),
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [{ role: "user", content }],
      stream: false,
    });
    await recordTokenUsage(userId, quota.day, message.usage?.input_tokens ?? 0, message.usage?.output_tokens ?? 0);

    const block = message.content.find((b) => b.type === "tool_use" && b.name === TOOL_NAME);
    const parsed = ResultSchema.safeParse(block && block.type === "tool_use" ? block.input : null);
    if (!parsed.success) return empty("failed");

    const result = emptyExtraction(images.length);
    for (const r of parsed.data.receipts) {
      if (r.index < 0 || r.index >= images.length) continue;
      result.receipts[r.index] = {
        kind: r.kind,
        merchant: r.merchant,
        merchantAddress: r.merchantAddress,
        date: toIso(r.date),
        time: r.time,
        invoiceNumbers: r.invoiceNumbers,
        poRef: r.poRef,
        lineItems: r.lineItems.map((l) => ({ description: l.description, qty: l.qty, amountCents: cents(l.amount) })),
        subtotalCents: cents(r.subtotal),
        taxCents: cents(r.tax),
        tipCents: cents(r.tip),
        totalCents: cents(r.total),
        currency: r.currency,
        paymentMethod: r.paymentMethod,
        cardLast4: r.cardLast4,
        confidence: r.confidence,
      };
    }
    const e = parsed.data.expense;
    result.expense = {
      merchant: e.merchant,
      purchasedAt: toIso(e.date),
      amountChargedCents: cents(e.amountCharged),
      purpose: e.purpose,
      teamMeal: e.teamMeal,
      cardLast4: e.cardLast4,
    };
    return result;
  } catch {
    return empty("failed");
  }
}
