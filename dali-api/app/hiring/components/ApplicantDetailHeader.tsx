import type React from "react";
import { useOsChrome } from "~/components/os-chrome";

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
  const { pageTitle, bodyText } = useOsChrome();
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className={pageTitle}>{name}</h1>
        <p className={bodyText}>
          {domainName} · {cycleName}
        </p>
      </div>
      {statusSlot != null && <div className="flex flex-shrink-0 items-center gap-3">{statusSlot}</div>}
    </div>
  );
}
