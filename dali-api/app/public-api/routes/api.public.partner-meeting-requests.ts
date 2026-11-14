import type { Route } from "./+types/api.public.partner-meeting-requests";
import { handleWebsiteMeetingRequest } from "../lib/public-meeting-request.server";

// POST /api/public/partner-meeting-requests: dali.website's support plan finder
// asks DALI OS to email partners@ when a partner wants to meet. See
// public-meeting-request.server.ts.

export async function action({ request }: Route.ActionArgs) {
  return handleWebsiteMeetingRequest(request);
}

export async function loader() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
