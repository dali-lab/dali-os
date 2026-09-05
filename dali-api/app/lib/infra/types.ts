// Normalized shapes for the infrastructure dashboard. Pure types (no runtime),
// shared by the server adapters, the cached InfraSnapshot payload, and the UI.
// No dollar amounts anywhere — usage metrics only (see spec §1).

export type InfraProvider = "fly" | "neon";

// ── Fly ──────────────────────────────────────────────────────────────────────

export type FlyMachine = {
  id: string;
  name: string;
  appName: string;
  state: string; // started | stopped | suspended | destroyed | ...
  region: string;
  cpuKind: string; // shared | performance
  cpus: number;
  memoryMb: number;
  createdAt: string | null;
};

export type FlyVolume = {
  id: string;
  name: string;
  appName: string;
  region: string;
  sizeGb: number;
  state: string;
  attachedMachineId: string | null;
};

export type FlyApp = {
  id: string;
  name: string;
  status: string | null;
  machineCount: number;
  machines: FlyMachine[];
  volumes: FlyVolume[];
};

export type FlyInventory = {
  orgSlug: string;
  apps: FlyApp[];
};

// ── Neon ─────────────────────────────────────────────────────────────────────

export type NeonEndpoint = {
  id: string;
  branchId: string;
  type: string; // read_write | read_only
  currentState: string; // active | idle | init
  autoscalingMinCu: number | null;
  autoscalingMaxCu: number | null;
  suspendTimeoutSeconds: number | null;
  lastActive: string | null;
};

export type NeonBranch = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string | null;
  default: boolean;
};

// Per-project spend guardrails (0/absent = unlimited). logical_size is per
// branch; the rest are per-project per billing period. See spec §5 foot-gun.
export type NeonQuota = {
  activeTimeSeconds: number | null;
  computeTimeSeconds: number | null;
  writtenDataBytes: number | null;
  dataTransferBytes: number | null;
  logicalSizeBytes: number | null;
};

export type NeonProject = {
  id: string;
  name: string;
  regionId: string;
  pgVersion: number | null;
  createdAt: string | null;
  quota: NeonQuota;
  branches: NeonBranch[];
  endpoints: NeonEndpoint[];
};

export type NeonInventory = {
  orgId: string;
  projects: NeonProject[];
};

// ── Snapshot payloads (stored in InfraSnapshot.payload) ──────────────────────

export type FlySnapshotPayload = FlyInventory;
export type NeonSnapshotPayload = NeonInventory;
