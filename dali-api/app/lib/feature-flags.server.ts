import { prisma } from "~/lib/db";
import { cachedForRequest } from "~/lib/request-cache";
import type { UserRoles } from "~/lib/roles";
import {
  FEATURE_FLAGS,
  ROLE_TARGETS,
  evaluateFlag,
  evaluateVariant,
  isFeatureFlagKey,
  isHomeSurface,
  type FeatureFlagDef,
  type FeatureFlagKey,
  type FeatureFlagMap,
  type FlagConfig,
  type FlagVariant,
  type HomeSurface,
  type RoleTarget,
} from "~/lib/feature-flags";

// The registry as plain defs: FEATURE_FLAGS is `as const`, so its entries narrow
// to per-flag literal types and the optional fields (variants, defaultVariant)
// only exist on the flags that declare them. Lookups that read those go through
// this widened view; the resolve loop still uses FEATURE_FLAGS so `def.key`
// keeps its literal type for FeatureFlagMap.
const DEFS: readonly FeatureFlagDef[] = FEATURE_FLAGS;

// Flags that are on by default when you run the app outside production, so a
// design still behind its flag is what a local `npm run dev` actually shows.
// `defaultEnabled` can't express this — it seeds production too, which would be
// a silent rollout. Set DEV_FEATURE_FLAGS to a comma-separated key list to
// override (an empty value turns the whole mechanism off). Only the *default*
// moves: a FeatureFlag row, once an operator creates one in Admin → Feature
// Flags, still wins here exactly as it does in production.
const DEV_DEFAULT_ON: readonly FeatureFlagKey[] = ["os-redesign"];

function devDefaultOn(key: string): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const override = process.env.DEV_FEATURE_FLAGS;
  if (override === undefined) return (DEV_DEFAULT_ON as readonly string[]).includes(key);
  return override
    .split(",")
    .map((k) => k.trim())
    .includes(key);
}

function defaultConfig(def: FeatureFlagDef): FlagConfig {
  const forced = devDefaultOn(def.key);
  return {
    enabled: forced || (def.defaultEnabled ?? false),
    everyone: forced || (def.defaultEveryone ?? false),
    roles: [],
    userIds: [],
    variant: null,
  };
}

/**
 * Fetch all FeatureFlag rows, shared across the layout + route loaders for one
 * navigation. Without a request (or when caching isn't available), computes
 * directly.
 */
export async function getFeatureFlagRows(request?: Request) {
  const compute = async () => {
    const rows = await prisma.featureFlag.findMany();
    return new Map(rows.map((r) => [r.key, r]));
  };
  if (!request) return compute();
  return cachedForRequest(request, "featureFlagRows", compute);
}

// Resolve every registered flag for a user in one query. Call once per request
// (the layout loader already resolves `roles`) and plumb the map to the client.
export async function resolveFeatureFlags(
  userId: string,
  roles: UserRoles,
  request?: Request,
): Promise<FeatureFlagMap> {
  const byKey = await getFeatureFlagRows(request);

  const map = {} as FeatureFlagMap;
  for (const def of FEATURE_FLAGS) {
    const row = byKey.get(def.key);
    const config: FlagConfig = row
      ? {
          enabled: row.enabled,
          everyone: row.everyone,
          roles: row.roles,
          userIds: row.userIds,
          variant: row.variant,
        }
      : defaultConfig(def);
    map[def.key] = evaluateFlag(config, userId, roles);
  }
  return map;
}

// Single-flag guard for loaders/actions that don't already hold the resolved
// map (e.g. the /download loader).
export async function isFeatureEnabled(
  key: FeatureFlagKey,
  userId: string,
  roles: UserRoles,
  request?: Request,
): Promise<boolean> {
  const def = FEATURE_FLAGS.find((f) => f.key === key);
  if (!def) return false;
  const byKey = await getFeatureFlagRows(request);
  const row = byKey.get(key) ?? null;
  const config: FlagConfig = row
    ? {
        enabled: row.enabled,
        everyone: row.everyone,
        roles: row.roles,
        userIds: row.userIds,
        variant: row.variant,
      }
    : defaultConfig(def);
  return evaluateFlag(config, userId, roles);
}

// Whether a flag is live for the whole lab (master switch on AND targeting
// everyone), independent of any single user. For server-side features whose
// audience isn't the acting user — e.g. hiring automation that provisions a
// Meet link on the shared hiring calendar, where "which applicant" is not a
// meaningful target. Role/user-list targeting deliberately does NOT satisfy
// this: a partially-rolled-out flag stays off for these global paths until it
// reaches everyone.
export async function isFeatureEnabledForEveryone(
  key: FeatureFlagKey,
  request?: Request,
): Promise<boolean> {
  const def = FEATURE_FLAGS.find((f) => f.key === key);
  if (!def) return false;
  const byKey = await getFeatureFlagRows(request);
  const row = byKey.get(key) ?? null;
  const config: FlagConfig = row
    ? {
        enabled: row.enabled,
        everyone: row.everyone,
        roles: row.roles,
        userIds: row.userIds,
        variant: row.variant,
      }
    : defaultConfig(def);
  return config.enabled && config.everyone;
}

// Which of a multi-value flag's options applies to this user, or null when the
// flag doesn't target them.
export async function resolveFlagVariant(
  key: FeatureFlagKey,
  userId: string,
  roles: UserRoles,
  request?: Request,
): Promise<string | null> {
  const def = DEFS.find((f) => f.key === key);
  if (!def?.variants) return null;
  const byKey = await getFeatureFlagRows(request);
  const row = byKey.get(key) ?? null;
  const config: FlagConfig = row
    ? {
        enabled: row.enabled,
        everyone: row.everyone,
        roles: row.roles,
        userIds: row.userIds,
        variant: row.variant,
      }
    : defaultConfig(def);
  return evaluateVariant(def, config, userId, roles);
}

// Which home page this member lands on. "home-surface" decides when it targets
// them; otherwise the home redesign travels with the new left navigation, so
// members on that get the search-first home and everyone else keeps today's.
export async function resolveHomeSurface(
  userId: string,
  roles: UserRoles,
  request?: Request,
): Promise<HomeSurface> {
  const chosen = await resolveFlagVariant("home-surface", userId, roles, request);
  if (isHomeSurface(chosen)) return chosen;
  return (await isFeatureEnabled("sidebar-redesign", userId, roles, request)) ? "search" : "classic";
}

export type AdminFlagView = {
  key: FeatureFlagKey;
  label: string;
  description: string;
  enabled: boolean;
  everyone: boolean;
  roles: RoleTarget[];
  userIds: string[];
  note: string | null;
  /** Empty for plain on/off flags. */
  variants: readonly FlagVariant[];
  /** The option targeted users get; null (and unused) for on/off flags. */
  variant: string | null;
};

// Registry defs left-joined with their rows (registry defaults fill unseeded
// flags), for the admin panel loader — mirrors admin.jobs.tsx's JOBS.map.
export async function listFlagsForAdmin(): Promise<AdminFlagView[]> {
  const rows = await prisma.featureFlag.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return DEFS.map((def) => {
    const row = byKey.get(def.key);
    const config = row
      ? {
          enabled: row.enabled,
          everyone: row.everyone,
          roles: row.roles,
          userIds: row.userIds,
          variant: row.variant,
          note: row.note,
        }
      : { ...defaultConfig(def), note: null };
    return {
      key: def.key as FeatureFlagKey,
      label: def.label,
      description: def.description,
      enabled: config.enabled,
      everyone: config.everyone,
      // Drop any role keys no longer in ROLE_TARGETS so stale rows don't leak
      // unknown values into the UI.
      roles: config.roles.filter((r): r is RoleTarget =>
        (ROLE_TARGETS as readonly string[]).includes(r),
      ),
      userIds: config.userIds,
      note: config.note,
      variants: def.variants ?? [],
      variant: def.variants
        ? (config.variant ?? def.defaultVariant ?? null)
        : null,
    };
  });
}

// Persist an admin edit. Upsert so the first edit seeds the row from registry
// defaults, then applies the change (same create-then-apply shape as jobs).
export async function updateFlag(
  key: string,
  patch: {
    enabled: boolean;
    everyone: boolean;
    roles: string[];
    userIds: string[];
    note: string | null;
    variant?: string | null;
  },
): Promise<void> {
  if (!isFeatureFlagKey(key)) throw new Error(`Unknown feature flag: ${key}`);
  const def = DEFS.find((f) => f.key === key)!;
  const roles = patch.roles.filter((r) => (ROLE_TARGETS as readonly string[]).includes(r));
  // Only multi-value flags carry a variant, and only one the registry declares
  // — an unknown option would resolve to the default anyway, so reject it at
  // the write instead of storing a value that silently does nothing.
  if (patch.variant != null && !def.variants?.some((v) => v.value === patch.variant)) {
    throw new Error(`Unknown variant for ${key}: ${patch.variant}`);
  }
  const data = {
    enabled: patch.enabled,
    everyone: patch.everyone,
    roles,
    userIds: patch.userIds,
    note: patch.note,
    variant: def.variants ? (patch.variant ?? def.defaultVariant ?? null) : null,
  };
  await prisma.featureFlag.upsert({
    where: { key },
    create: { key, ...data },
    update: data,
  });
}
