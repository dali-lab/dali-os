// Protected-resource allowlist — the primary safety rail. The DALI OS platform's
// own infra (the app the dashboard runs on + its Neon project) must NEVER be
// destroyed or quota-limited from the dashboard, regardless of who clicks. This
// is enforced server-side before any destructive/quota write, independent of the
// UI hiding controls. Per-client-project infra is deliberately NOT protected —
// decommissioning a finished project is a legitimate Admin action.

const DEFAULT_PROTECTED_FLY_APPS = ["dali-api-prod", "dali-api-staging"];

function splitEnv(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

// The Fly apps that can't be destroyed: the built-in platform apps, the running
// app itself (FLY_APP_NAME), and any operator-configured extras.
export function protectedFlyApps(): string[] {
  const self = process.env.FLY_APP_NAME;
  return [
    ...new Set([
      ...DEFAULT_PROTECTED_FLY_APPS,
      ...(self ? [self] : []),
      ...splitEnv(process.env.INFRA_PROTECTED_FLY_APPS),
    ]),
  ];
}

// Neon project ids that can't be deleted or quota-limited. The platform's prod
// Neon project id(s) belong here — set via INFRA_PROTECTED_NEON_PROJECTS.
export function protectedNeonProjectIds(): string[] {
  return splitEnv(process.env.INFRA_PROTECTED_NEON_PROJECTS);
}

export function isFlyAppProtected(appName: string): boolean {
  return protectedFlyApps().includes(appName);
}

export function isNeonProjectProtected(projectId: string): boolean {
  return protectedNeonProjectIds().includes(projectId);
}

export class ProtectedResourceError extends Error {
  constructor(resource: string) {
    super(
      `"${resource}" is a protected platform resource and cannot be modified from the dashboard.`,
    );
    this.name = "ProtectedResourceError";
  }
}

export function assertFlyAppMutable(appName: string): void {
  if (isFlyAppProtected(appName)) throw new ProtectedResourceError(appName);
}

export function assertNeonProjectMutable(projectId: string): void {
  if (isNeonProjectProtected(projectId)) throw new ProtectedResourceError(projectId);
}
