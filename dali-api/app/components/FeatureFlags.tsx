import { createContext, useContext, type ReactNode } from "react";
import type { FeatureFlagKey, FeatureFlagMap } from "~/lib/feature-flags";

// The resolved flag map is computed server-side in the layout loader
// (resolveFeatureFlags) and plumbed here. Each workspace iframe runs the
// layout loader itself, so mounting the provider in Layout (and the
// tabless/embedded branch) covers both the shell and in-iframe documents.
//
// An empty map means "no provider" — an unresolved flag reads as off, which is
// the safe default for any component rendered outside the provider.
const FeatureFlagsContext = createContext<Partial<FeatureFlagMap>>({});

export function FeatureFlagsProvider({
  flags,
  children,
}: {
  flags: Partial<FeatureFlagMap>;
  children: ReactNode;
}) {
  return (
    <FeatureFlagsContext.Provider value={flags}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFeatureFlag(key: FeatureFlagKey): boolean {
  return useContext(FeatureFlagsContext)[key] ?? false;
}
