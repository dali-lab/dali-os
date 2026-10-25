// Admin-only "Infrastructure (optional)" block on the New project form. Fields
// post with the create form; the hub action provisions after the project row
// exists (lib/infra/provision.server.ts).

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Checkbox } from "~/components/ui/Checkbox";
import { Select } from "~/components/ui/floating";
import { cn } from "~/lib/cn";
import type { ProvisionTargets } from "~/lib/infra/provision.server";

const INPUT =
  "px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-os-accent/30";
const SELECT_BUTTON =
  "px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40";

export function NewProjectInfraFields({ targets }: { targets: ProvisionTargets }) {
  const [open, setOpen] = useState(false);
  const [neon, setNeon] = useState(false);
  const [fly, setFly] = useState(false);

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-foreground"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", !open && "-rotate-90")} />
        Infrastructure (optional)
      </button>
      <div className={cn("flex flex-col gap-3 border-t border-border px-3 py-3", !open && "hidden")}>
        <OrgBlock
          kind="neon"
          checked={neon}
          onChecked={setNeon}
          orgs={targets.neonOrgs}
          label="Create a Neon database"
          hint="Starts at 0.25 to 2 CU. The connection string is in the Neon console."
          orgName="neonOrgId"
          nameField="neonName"
          namePlaceholder="Defaults to the project name"
          emptyHint="No Neon org is set on any project yet. Set one in a project's Infrastructure section first."
        />
        <OrgBlock
          kind="fly"
          checked={fly}
          onChecked={setFly}
          orgs={targets.flyOrgs}
          label="Create a Fly app"
          hint="An empty app the team deploys into. App names are unique across all of Fly."
          orgName="flyOrgSlug"
          nameField="flyAppName"
          namePlaceholder="Defaults to the project name, lowercase with hyphens"
          emptyHint="No project has a Fly write token yet. Add one in a project's Infrastructure section first."
        />
      </div>
    </div>
  );
}

function OrgBlock(props: {
  kind: "neon" | "fly";
  checked: boolean;
  onChecked: (v: boolean) => void;
  orgs: string[];
  label: string;
  hint: string;
  orgName: string;
  nameField: string;
  namePlaceholder: string;
  emptyHint: string;
}) {
  const disabled = props.orgs.length === 0;
  return (
    <div className="flex flex-col gap-2">
      <Checkbox
        tone="os"
        name={props.kind === "neon" ? "createNeon" : "createFly"}
        checked={props.checked && !disabled}
        disabled={disabled}
        onChange={(e) => props.onChecked(e.currentTarget.checked)}
        label={props.label}
        description={disabled ? props.emptyHint : props.hint}
      />
      {props.checked && !disabled && (
        <div className="grid grid-cols-1 gap-3 pl-6 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Org</span>
            <Select
              name={props.orgName}
              defaultValue={props.orgs[0]}
              options={props.orgs.map((o) => ({ value: o, label: o }))}
              buttonClassName={SELECT_BUTTON}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">{props.kind === "neon" ? "Database name" : "App name"}</span>
            <input name={props.nameField} placeholder={props.namePlaceholder} className={INPUT} />
          </label>
        </div>
      )}
    </div>
  );
}
