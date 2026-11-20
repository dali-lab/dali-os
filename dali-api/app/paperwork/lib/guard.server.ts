import type { UserRoles } from "~/lib/roles";
import { guardMemberFeature } from "~/lib/feature-guard.server";

export type PaperworkGuard =
  | { ok: true; userId: string; roles: UserRoles }
  | { ok: false; response: Response };

export async function guardPaperwork(request: Request, opts: { page: boolean }): Promise<PaperworkGuard> {
  const guard = await guardMemberFeature(request, {
    flag: "paperwork",
    page: opts.page,
    json: (error) => ({ error }),
    unauthorizedMessage: "Unauthorized",
  });
  return guard.ok ? { ok: true, userId: guard.userId, roles: guard.roles } : guard;
}
