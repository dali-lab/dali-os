import { getEnv } from "~/lib/env.server";
// Protected platform infra refuses every mutating dashboard action, for every role.

const DEFAULT_PROTECTED_FLY_APPS = ["dali-api-prod", "dali-api-staging"];

function splitEnv(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function protectedFlyApps(): string[] {
  const self = getEnv().FLY_APP_NAME;
  return [
    ...new Set([
      ...DEFAULT_PROTECTED_FLY_APPS,
      ...(self ? [self] : []),
      ...splitEnv(getEnv().INFRA_PROTECTED_FLY_APPS),
    ]),
  ];
}

export function protectedNeonProjectIds(): string[] {
  return splitEnv(getEnv().INFRA_PROTECTED_NEON_PROJECTS);
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
