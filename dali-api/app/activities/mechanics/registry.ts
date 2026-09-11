// Client-side mechanic registry (specs/activities.md §5). Keyed by
// Activity.kind. Holds the React pieces a mechanic renders: the scattered
// on-page Overlay, the Surface page, the admin config editor, plus small bits of
// copy/defaults. The mirrored SERVER registry (registry.server.ts) holds the
// data/logic. Client-safe: no server imports.

import type { ComponentType } from "react";
import { scavengerHuntClient } from "./scavenger-hunt";

export type OverlayProps = {
  activityId: string;
  name: string;
  overlay: unknown; // the server's route-filtered payload
};

export type SurfaceProps = {
  activityId: string;
  name: string;
  /** False once the window has closed (rare race); disables mutating controls. */
  active: boolean;
  currentUserId: string;
  nameByUserId: Record<string, string>;
  progress: unknown;
  results: unknown;
  /** Endpoint the surface's forms post to (the /api/activities/:id action). */
  submitAction: string;
  /** Called after a successful mutation so the host modal reloads its data. */
  onChanged?: () => void;
};

export type AdminEditorProps = {
  value: unknown; // the mechanic's config
  onChange: (v: unknown) => void;
};

export type MechanicClient = {
  kind: string;
  Overlay: ComponentType<OverlayProps>;
  Surface: ComponentType<SurfaceProps>;
  AdminEditor: ComponentType<AdminEditorProps>;
  defaultConfig: () => unknown;
  bannerCta: string;
};

const MECHANICS: Record<string, MechanicClient> = {
  [scavengerHuntClient.kind]: scavengerHuntClient,
};

export function mechanicClient(kind: string): MechanicClient | undefined {
  return MECHANICS[kind];
}
