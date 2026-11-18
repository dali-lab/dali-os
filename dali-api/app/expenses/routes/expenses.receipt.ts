import type { Route } from "./+types/expenses.receipt";
import { isS3Configured } from "~/lib/s3.server";
import { openReceipt, receiptLink } from "../lib/expenses.server";
import { failure, guardExpenses } from "./guard.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const guard = await guardExpenses(request, { write: false, page: false });
  if (!guard.ok) return guard.response;
  if (!isS3Configured()) return Response.json({ ok: false, error: "Receipt files aren't available right now." }, { status: 503 });
  try {
    if (new URL(request.url).searchParams.get("link") === "1") {
      return Response.json({ url: await receiptLink(guard.viewer, params.receiptId) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const { body, contentType } = await openReceipt(guard.viewer, params.receiptId);
    return new Response(body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
