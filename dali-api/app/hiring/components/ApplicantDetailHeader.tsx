import type React from "react";

// Applicant name + "domain · cycle" subtitle for the hiring detail routes,
// with an optional status pill rendered top-right.
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
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{name}</h1>
        <p className="mt-1 text-muted-foreground">
          {domainName} · {cycleName}
        </p>
      </div>
      {statusSlot != null && <div className="flex-shrink-0">{statusSlot}</div>}
    </div>
  );
}
