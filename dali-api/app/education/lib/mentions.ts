// Education-scoped helper. The shared @-mention parser/resolver lives in
// `app/lib/mentions.ts`; the roster loader for an offering lives in
// `app/lib/mentions.server.ts`. This file is preserved as a thin
// pass-through for the existing import path used by callers.

import { resolveMentions, type MentionMatch } from "~/lib/mentions";
import { loadOfferingRoster } from "~/lib/mentions.server";

export type { MentionMatch };

export async function resolveOfferingMentions(
  body: string,
  offeringId: string,
): Promise<MentionMatch[]> {
  const roster = await loadOfferingRoster(offeringId);
  return resolveMentions(body, roster);
}

// Backwards-compat alias for the old API name.
export { resolveOfferingMentions as resolveMentions };
