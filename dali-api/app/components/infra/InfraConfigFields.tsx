// A project's infra config fields: Fly and Neon each pick an org (one already
// in use, or a new one) and the apps / databases in it that belong to the
// project. Field names match infraConfigFromForm(); the caller owns the <form>
// (the project hub's Infrastructure section, the Admin console).

import { useState } from "react";
import { Checkbox } from "~/components/ui/Checkbox";
import { Combobox, MultiSelect } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { keepLinkedInOrg, orgResourceOptions, type KnownOrg } from "~/lib/infra/infra-scope";

export type InfraConfigValues = {
  flyOrgSlug: string | null;
  flyAppNames: string[];
  neonOrgId: string | null;
  neonProjectIds: string[];
  infraEnabled: boolean;
  hasFlyReadToken: boolean;
  hasFlyWriteToken: boolean;
};

const ORG_ID = /^[a-z0-9-]{1,63}$/;

/** Known orgs plus the project's own org, which may not be swept yet. */
export function withOwnOrg(
  known: KnownOrg[],
  orgId: string | null,
  resources: { id: string; name: string }[],
): KnownOrg[] {
  if (!orgId || known.some((o) => o.orgId === orgId)) return known;
  return [...known, { orgId, resources }];
}

export function InfraConfigFields({
  config,
  knownOrgs,
}: {
  config: InfraConfigValues;
  knownOrgs: { fly: KnownOrg[]; neon: KnownOrg[] };
}) {
  const { fieldLabel } = useOsChrome();
  const [flyOrg, setFlyOrg] = useState(config.flyOrgSlug ?? "");
  const flyOrgInUse = knownOrgs.fly.some((o) => o.orgId === flyOrg && o.orgId !== config.flyOrgSlug);
  const tokenHint = (has: boolean) =>
    has ? "Set. Leave blank to keep" : flyOrgInUse ? "Blank reuses this org's token" : "FlyV1 …";

  return (
    <div className="flex flex-col gap-4">
      <OrgPicker
        provider="Fly"
        orgLabel="Fly org"
        orgField="flyOrgSlug"
        resourceLabel="Fly apps"
        resourceField="flyAppNames"
        placeholder="dali-os"
        known={knownOrgs.fly}
        initialOrg={config.flyOrgSlug ?? ""}
        initialLinked={config.flyAppNames}
        onOrgChange={setFlyOrg}
      />
      {flyOrg && (
        <div className="flex flex-wrap gap-3">
          <label className={cn(fieldLabel, "w-56")}>
            <span>Fly read token</span>
            <input name="flyReadToken" type="password" placeholder={tokenHint(config.hasFlyReadToken)} className="w-full" />
          </label>
          <label className={cn(fieldLabel, "w-56")}>
            <span>Fly write token</span>
            <input name="flyWriteToken" type="password" placeholder={tokenHint(config.hasFlyWriteToken)} className="w-full" />
          </label>
        </div>
      )}
      <OrgPicker
        provider="Neon"
        orgLabel="Neon org"
        orgField="neonOrgId"
        resourceLabel="Neon databases"
        resourceField="neonProjectIds"
        placeholder="org-acme-1234"
        known={knownOrgs.neon}
        initialOrg={config.neonOrgId ?? ""}
        initialLinked={config.neonProjectIds}
      />
      <Checkbox name="infraEnabled" defaultChecked={config.infraEnabled} label="Sweep enabled" />
    </div>
  );
}

function OrgPicker(props: {
  provider: string;
  orgLabel: string;
  orgField: string;
  resourceLabel: string;
  resourceField: string;
  placeholder: string;
  known: KnownOrg[];
  initialOrg: string;
  initialLinked: string[];
  onOrgChange?: (org: string) => void;
}) {
  const { fieldLabel } = useOsChrome();
  const [org, setOrg] = useState(props.initialOrg);
  const [linked, setLinked] = useState(props.initialLinked);
  const [orgOptions, setOrgOptions] = useState(() => props.known.map((o) => ({ value: o.orgId, label: o.orgId })));
  const isNewOrg = org !== "" && !props.known.some((o) => o.orgId === org);

  function chooseOrg(next: string) {
    if (next && !orgOptions.some((o) => o.value === next)) {
      setOrgOptions((opts) => [...opts, { value: next, label: next }]);
    }
    setOrg(next);
    setLinked((ids) => keepLinkedInOrg(next, props.known, ids));
    props.onOrgChange?.(next);
  }

  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className={cn(fieldLabel, "w-56")}>
        <span>{props.orgLabel}</span>
        <Combobox
          ariaLabel={props.orgLabel}
          value={org}
          options={[{ value: "", label: "None" }, ...orgOptions]}
          onChange={chooseOrg}
          placeholder={props.placeholder}
          allowCustom={(q) => (ORG_ID.test(q) ? { value: q, label: `Add ${q}` } : null)}
          emptyLabel="Type an org to add it"
        />
        <input type="hidden" name={props.orgField} value={org} />
      </div>
      <div className={cn(fieldLabel, "min-w-[16rem] flex-1")}>
        <span>{props.resourceLabel}</span>
        <MultiSelect
          ariaLabel={props.resourceLabel}
          values={linked}
          options={orgResourceOptions(org, props.known, linked)}
          onChange={setLinked}
          placeholder="None linked"
          disabled={org === ""}
          emptyLabel={
            isNewOrg
              ? `Save to load this ${props.provider} org, then edit again to pick.`
              : `Nothing in this ${props.provider} org yet.`
          }
        />
        {linked.map((id) => (
          <input key={id} type="hidden" name={props.resourceField} value={id} />
        ))}
      </div>
    </div>
  );
}
