import type { Route } from "./+types/api.places.search";
import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { searchCities } from "~/lib/places/cities.server";

const MIN_CHARS = 2;
const MAX_CHARS = 60;
const BOOST_TTL_MS = 5 * 60 * 1000;

let boost: { ids: Set<number>; at: number } | null = null;

async function boostedGeonameIds(now = Date.now()): Promise<Set<number>> {
  if (boost && now - boost.at < BOOST_TTL_MS) return boost.ids;
  const rows = await prisma.user.findMany({
    where: { currentLocationGeonameId: { not: null } },
    distinct: ["currentLocationGeonameId"],
    select: { currentLocationGeonameId: true },
  });
  const ids = new Set(rows.flatMap((r) => (r.currentLocationGeonameId == null ? [] : [r.currentLocationGeonameId])));
  boost = { ids, at: now };
  return ids;
}

export function resetPlaceBoostCache() {
  boost = null;
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < MIN_CHARS || q.length > MAX_CHARS) return Response.json({ places: [] });

  const places = searchCities(q, { boostGeonameIds: await boostedGeonameIds() });
  return Response.json({ places });
}
