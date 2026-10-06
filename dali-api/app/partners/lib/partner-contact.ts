// Shared PartnerContact vocabulary (spec §7), imported by the contact route
// and the manage_partner_contact MCP tool so the channel list can't drift.

import type { PartnerChannel } from "~/generated/prisma/enums";

export const PARTNER_CHANNELS: PartnerChannel[] = ["Email", "Phone", "Slack", "Other"];

export const PARTNER_CHANNEL_LABELS: Record<PartnerChannel, string> = {
  Email: "Email",
  Phone: "Phone",
  Slack: "Slack",
  Other: "Other",
};

export function isPartnerChannel(x: unknown): x is PartnerChannel {
  return typeof x === "string" && (PARTNER_CHANNELS as string[]).includes(x);
}
