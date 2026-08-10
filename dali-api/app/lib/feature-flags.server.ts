import { prisma } from "~/lib/db";
import type { UserRoles } from "~/lib/roles";
import {
  FEATURE_FLAGS,
  ROLE_TARGETS,
  isFeatureFlagKey,
  type FeatureFlagDef,
  type FeatureFlagKey,
  type FeatureFlagMap,
  type RoleTarget,
} from "~/lib/feature-flags";

// The evaluable shape of a flag — either a DB FeatureFlag row or a registry
// default synthesized for a flag that has no row yet.
type FlagConfig = {
  enabled: boolean;
  everyone: boolean;
  roles: string[];
  userIds: string[];
};

function defaultConfig(def: FeatureFlagDef): FlagConfig {
  return {
    enabled: def.defaultEnabled ?? false,
    everyone: def.defaultEveryone ?? false,
    roles: [],
    userIds: [],
  };
}

// A flag is on for a user iff the master switch is set AND any targeting rule
// matches: everyone, an explicit allowlist entry, or a held role. Missing
// row => registry default (off unless the def opts in), evaluated identically.
export function evaluateFlag(
  config: FlagConfig,
  userId: string,
  roles: UserRoles,
): boolean {
  if (!config.enabled) return false;
  if (config.everyone) return true;
  if (config.userIds.includes(userId)) return true;
  return config.roles.some((k) => k in roles && roles[k as keyof UserRoles]);
}

// Resolve every registered flag for a user in one query. Call once per request
// (the layout loader already resolves `roles`) and plumb the map to the client.
export async function resolveFeatureFlags(
  userId: string,
  roles: UserRoles,
): Promise<FeatureFlagMap> {
  const rows = await prisma.featureFlag.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));

  const map = {} as FeatureFlagMap;
  for (const def of FEATURE_FLAGS) {
    const row = byKey.get(def.key);
    const config: FlagConfig = row
      ? { enabled: row.enabled, everyone: row.everyone, roles: row.roles, userIds: row.userIds }
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
): Promise<boolean> {
  const def = FEATURE_FLAGS.find((f) => f.key === key);
  if (!def) return false;
  const row = await prisma.featureFlag.findUnique({ where: { key } });
  const config: FlagConfig = row
    ? { enabled: row.enabled, everyone: row.everyone, roles: row.roles, userIds: row.userIds }
    : defaultConfig(def);
  return evaluateFlag(config, userId, roles);
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
};

// Registry defs left-joined with their rows (registry defaults fill unseeded
// flags), for the admin panel loader — mirrors admin.jobs.tsx's JOBS.map.
export async function listFlagsForAdmin(): Promise<AdminFlagView[]> {
  const rows = await prisma.featureFlag.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return FEATURE_FLAGS.map((def) => {
    const row = byKey.get(def.key);
    const config = row
      ? { enabled: row.enabled, everyone: row.everyone, roles: row.roles, userIds: row.userIds, note: row.note }
      : { ...defaultConfig(def), note: null };
    return {
      key: def.key,
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
    };
  });
}

// Persist an admin edit. Upsert so the first edit seeds the row from registry
// defaults, then applies the change (same create-then-apply shape as jobs).
export async function updateFlag(
  key: string,
  patch: { enabled: boolean; everyone: boolean; roles: string[]; userIds: string[]; note: string | null },
): Promise<void> {
  if (!isFeatureFlagKey(key)) throw new Error(`Unknown feature flag: ${key}`);
  const roles = patch.roles.filter((r) => (ROLE_TARGETS as readonly string[]).includes(r));
  const data = {
    enabled: patch.enabled,
    everyone: patch.everyone,
    roles,
    userIds: patch.userIds,
    note: patch.note,
  };
  await prisma.featureFlag.upsert({
    where: { key },
    create: { key, ...data },
    update: data,
  });
}
