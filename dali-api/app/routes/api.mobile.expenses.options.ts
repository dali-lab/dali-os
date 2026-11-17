import type { Route } from "./+types/api.mobile.expenses.options";
import { mobileJson } from "~/lib/mobile-auth.server";
import { mobileOptions, requireMobileExpenses } from "~/expenses/lib/mobile.server";

export async function loader({ request }: Route.LoaderArgs) {
  const guard = await requireMobileExpenses(request);
  if (!guard.ok) return guard.response;
  return mobileJson(await mobileOptions(guard.userId));
}
