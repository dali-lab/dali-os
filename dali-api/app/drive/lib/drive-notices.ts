// One-shot messages a redirect into Drive can carry as `?notice=<key>`. The hub
// shows the toast once and drops the param.
export const DRIVE_NOTICES = {
  "form-view-only": "You can see this form but not edit it. Ask its owner for edit access to open the editor.",
  "form-no-access": "You don't have access to that form.",
} as const;

export type DriveNoticeKey = keyof typeof DRIVE_NOTICES;

export function driveNoticeMessage(key: string | null): string | null {
  if (!key) return null;
  return Object.hasOwn(DRIVE_NOTICES, key) ? DRIVE_NOTICES[key as DriveNoticeKey] : null;
}
