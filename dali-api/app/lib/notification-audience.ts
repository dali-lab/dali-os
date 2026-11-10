import type { Audience } from "~/lib/notification-events";

export function notificationSettingsPath(audience: Audience): string {
  if (audience === "partner") return "/partner/settings#notifications";
  if (audience === "portal") return "/portal/settings#notifications";
  return "/settings/notifications";
}
