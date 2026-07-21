import type React from "react";
import { PageHeader } from "~/hiring/components/PageHeader";

// Applicant name + "domain · cycle" subtitle for the hiring detail routes,
// with an optional status pill rendered inline beside the name. Delegates to
// the shared PageHeader so every detail view opens with the same Dosis title,
// spacing, and chip placement as the rest of the hiring area.
export function ApplicantDetailHeader({
  name,
  domainName,
  cycleName,
  statusSlot,
}: {
  name: string;
  domainName: string;
  cycleName: string;
  statusSlot?: React.ReactNode;
}): React.ReactElement {
  return (
    <PageHeader
      title={name}
      subtitle={`${domainName} · ${cycleName}`}
      chip={statusSlot}
    />
  );
}
