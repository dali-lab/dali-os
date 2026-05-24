import { useEffect, useRef, useState } from "react";
import { Form, Link, redirect, useActionData, useFetcher, useLoaderData, useNavigation, useSubmit } from "react-router";
import type { Route } from "./+types/members.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin, isCore } from "~/lib/roles";
import { initialsFromName } from "~/lib/display";
import { resolvePhotoUrl } from "~/lib/photo";
import { EditableSection } from "~/components/EditableSection";
import { PhotoUploadField } from "~/components/PhotoUploadField";
import {
  ALLOWED_LEVELS,
  parseLevel,
  type Level,
} from "~/admin-console/lib/eligibility";
import {
  addOrUpdateEligibility,
  removeEligibility,
} from "~/admin-console/lib/eligibility.server";
import { Plus, X } from "lucide-react";

export const meta: Route.MetaFunction = ({ data }) => {
  const m = (data as { member?: { firstName: string; lastName: string } } | undefined)?.member;
  return [{ title: m ? `${m.firstName} ${m.lastName} · Members · DALI OS` : "Member · DALI OS" }];
};

// Profile fields a member (or an admin) may edit. Identity/auth columns
// (netId, *Email) are intentionally not here. photoUrl is handled separately
// via the image-upload control, not as a plain text field.
const TEXT_FIELDS = [
  "firstName",
  "lastName",
  "pronouns",
  "major",
  "hometown",
  "linkedinUrl",
  "githubUrl",
  "personalSite",
  "timeZone",
] as const;

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");

  const member = await prisma.user.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      daliEmail: true,
      dartmouthEmail: true,
      pronouns: true,
      classYear: true,
      major: true,
      hometown: true,
      linkedinUrl: true,
      githubUrl: true,
      personalSite: true,
      photoUrl: true,
      timeZone: true,
      domainEligibilities: {
        select: {
          id: true,
          level: true,
          promotedAt: true,
          promotedBy: true,
          domain: { select: { id: true, displayName: true } },
        },
        orderBy: { domain: { displayName: "asc" } },
      },
    },
  });
  if (!member) throw new Response("Not found", { status: 404 });

  // Profile is editable by admins or the member viewing their own profile.
  // Eligibility is editable by Admin or Core only (Core has hiring-equivalent
  // authority over membership state per V0_PLAN.md). A member cannot promote
  // themselves.
  const admin = await isAdmin(auth.user.sub);
  const canEdit = admin || auth.user.sub === member.id;
  const canManageEligibility = await isCore(auth.user.sub);

  const allDomains = await prisma.domain.findMany({
    where: { active: true },
    select: { id: true, displayName: true },
    orderBy: { displayName: "asc" },
  });

  // Resolve for the header <img>. The raw key stays on `member.photoUrl` so
  // the upload field's hidden input round-trips it unchanged on save.
  const photoUrlResolved = await resolvePhotoUrl(member.photoUrl);

  return {
    member: {
      ...member,
      domainEligibilities: member.domainEligibilities.map((e) => ({
        id: e.id,
        level: e.level as Level,
        promotedAt: e.promotedAt.toISOString(),
        promotedBy: e.promotedBy,
        domain: e.domain,
      })),
    },
    canEdit,
    canManageEligibility,
    allDomains,
    photoUrlResolved,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "profile");

  if (intent === "add-eligibility" || intent === "set-eligibility-level") {
    // Domain eligibility edits: Admin or Core only. A member cannot self-promote.
    if (!(await isCore(auth.user.sub))) {
      return { error: "You don't have permission to assign domains." };
    }
    const domainId = String(form.get("domainId") ?? "");
    const level = parseLevel(form.get("level"));
    if (!domainId || !level) {
      return { error: "Pick a domain and a level." };
    }
    await addOrUpdateEligibility({
      userId: params.id,
      domainId,
      level,
      actorId: auth.user.sub,
    });
    return null;
  }

  if (intent === "remove-eligibility") {
    if (!(await isCore(auth.user.sub))) {
      return { error: "You don't have permission to remove domains." };
    }
    const eligibilityId = String(form.get("eligibilityId") ?? "");
    if (!eligibilityId) return { error: "Missing eligibility id." };
    await removeEligibility({ id: eligibilityId });
    return null;
  }

  // Default: profile field update. Editable by admins or the member themself.
  const admin = await isAdmin(auth.user.sub);
  if (!admin && auth.user.sub !== params.id) {
    return { error: "You don't have permission to edit this member." };
  }

  const firstName = (form.get("firstName") as string | null)?.trim() ?? "";
  const lastName = (form.get("lastName") as string | null)?.trim() ?? "";
  if (!firstName || !lastName) {
    return { error: "First and last name are required." };
  }

  const data: Record<string, string | number | null> = {};
  for (const field of TEXT_FIELDS) {
    const raw = (form.get(field) as string | null)?.trim() ?? "";
    // Required fields stay as strings; optional ones become null when blank
    // so we don't store empty strings.
    if (field === "firstName" || field === "lastName") {
      data[field] = raw;
    } else {
      data[field] = raw === "" ? null : raw;
    }
  }

  // photoUrl carries an S3 key (or a legacy URL) from the upload control;
  // blank means "no photo".
  const photoUrlRaw = (form.get("photoUrl") as string | null)?.trim() ?? "";
  data.photoUrl = photoUrlRaw === "" ? null : photoUrlRaw;

  const classYearRaw = (form.get("classYear") as string | null)?.trim() ?? "";
  if (classYearRaw === "") {
    data.classYear = null;
  } else {
    const n = Number(classYearRaw);
    if (!Number.isInteger(n) || n < 1900 || n > 2100) {
      return { error: "Class year must be a 4-digit year." };
    }
    data.classYear = n;
  }

  await prisma.user.update({ where: { id: params.id }, data });
  return redirect(`/members/${params.id}`);
}

const FIELD_LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  pronouns: "Pronouns",
  major: "Major",
  hometown: "Hometown",
  linkedinUrl: "LinkedIn URL",
  githubUrl: "GitHub URL",
  personalSite: "Personal site",
  timeZone: "Time zone (IANA, e.g. America/New_York)",
};

export default function MemberDetail() {
  const { member, canEdit, canManageEligibility, allDomains, photoUrlResolved } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const formRef = useRef<HTMLFormElement | null>(null);
  const wasSubmitting = useRef(false);

  // This page renders inside a TabWorkspace iframe; a successful save only
  // revalidates the iframe's loaders, not the parent shell. Tell the parent
  // so it can refresh the sidebar avatar. A save that returns a validation
  // error keeps `actionData.error` set; a success redirects and clears it.
  useEffect(() => {
    if (navigation.state === "submitting") {
      wasSubmitting.current = true;
      return;
    }
    if (navigation.state === "idle" && wasSubmitting.current) {
      wasSubmitting.current = false;
      if (!actionData?.error && typeof window !== "undefined" && window.parent !== window) {
        window.parent.postMessage({ type: "dali:profileUpdated" }, window.location.origin);
      }
    }
  }, [navigation.state, actionData]);

  return (
    <div className="flex flex-col gap-4">
      <Link to="/members" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to members
      </Link>

      <header className="flex flex-col items-center gap-4 text-center">
        {photoUrlResolved ? (
          <img
            src={photoUrlResolved}
            alt=""
            className="w-32 h-32 rounded-lg object-cover border border-border"
          />
        ) : (
          <div className="w-32 h-32 rounded-lg border border-border bg-accent-coral/15 text-accent-coral flex items-center justify-center font-bold text-3xl">
            {initialsFromName(`${member.firstName} ${member.lastName}`)}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-bold text-foreground">
            {member.firstName} {member.lastName}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {member.daliEmail ?? member.dartmouthEmail ?? "No email on file"}
            {member.classYear ? ` · '${String(member.classYear).slice(-2)}` : ""}
          </p>
        </div>
      </header>

      {actionData?.error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionData.error}
        </div>
      )}

      <EditableSection
        title="Profile"
        canEdit={canEdit}
        onSave={() => {
          if (formRef.current) submit(formRef.current);
        }}
      >
        {({ editing }) => (
          <Form
            method="post"
            ref={formRef}
            className="flex flex-col gap-3 w-full"
          >
            <PhotoUploadField
              userId={member.id}
              name={`${member.firstName} ${member.lastName}`}
              initialKey={member.photoUrl}
              initialPreviewUrl={photoUrlResolved}
              readOnly={!editing}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {TEXT_FIELDS.map((field) => (
                <Field
                  key={field}
                  name={field}
                  label={FIELD_LABELS[field]}
                  defaultValue={(member[field] as string | null) ?? ""}
                  readOnly={!editing}
                />
              ))}
              <Field
                name="classYear"
                label="Class year"
                type="number"
                defaultValue={member.classYear?.toString() ?? ""}
                readOnly={!editing}
              />
            </div>
          </Form>
        )}
      </EditableSection>

      <DomainsSection
        eligibilities={member.domainEligibilities}
        allDomains={allDomains}
        canManage={canManageEligibility}
      />
    </div>
  );
}

function DomainsSection({
  eligibilities,
  allDomains,
  canManage,
}: {
  eligibilities: Array<{
    id: string;
    level: Level;
    promotedAt: string;
    promotedBy: string | null;
    domain: { id: string; displayName: string };
  }>;
  allDomains: Array<{ id: string; displayName: string }>;
  canManage: boolean;
}) {
  const assignedDomainIds = new Set(eligibilities.map((e) => e.domain.id));
  const available = allDomains.filter((d) => !assignedDomainIds.has(d.id));

  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Domains &amp; levels</h2>
        {!canManage && (
          <span className="text-[11px] text-muted-foreground/70">
            Only Core or Admin can edit.
          </span>
        )}
      </div>
      {eligibilities.length === 0 && !canManage && (
        <p className="text-sm text-muted-foreground/70 italic">No domain eligibilities yet.</p>
      )}
      <div className="flex flex-col gap-2">
        {eligibilities.map((e) => (
          <EligibilityRow
            key={e.id}
            eligibility={e}
            canManage={canManage}
          />
        ))}
      </div>
      {canManage && available.length > 0 && (
        <AddEligibility domains={available} />
      )}
      {canManage && available.length === 0 && eligibilities.length === allDomains.length && (
        <p className="text-xs text-muted-foreground/60">All active domains are assigned.</p>
      )}
    </section>
  );
}

function EligibilityRow({
  eligibility,
  canManage,
}: {
  eligibility: {
    id: string;
    level: Level;
    domain: { id: string; displayName: string };
  };
  canManage: boolean;
}) {
  const setFetcher = useFetcher();
  const removeFetcher = useFetcher();
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-border bg-background/40">
      <span className="text-sm font-medium text-foreground">{eligibility.domain.displayName}</span>
      <div className="flex items-center gap-2">
        {canManage ? (
          <setFetcher.Form method="post" className="flex items-center gap-1">
            <input type="hidden" name="intent" value="set-eligibility-level" />
            <input type="hidden" name="domainId" value={eligibility.domain.id} />
            <select
              name="level"
              defaultValue={eligibility.level}
              onChange={(e) => setFetcher.submit(e.currentTarget.form)}
              className="text-xs font-medium px-2 py-1 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              aria-label={`Level for ${eligibility.domain.displayName}`}
            >
              {ALLOWED_LEVELS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </setFetcher.Form>
        ) : (
          <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
            {eligibility.level}
          </span>
        )}
        {canManage && (
          <removeFetcher.Form method="post" className="inline">
            <input type="hidden" name="intent" value="remove-eligibility" />
            <input type="hidden" name="eligibilityId" value={eligibility.id} />
            <button
              type="submit"
              aria-label={`Remove ${eligibility.domain.displayName}`}
              className="text-muted-foreground hover:text-red-600 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </removeFetcher.Form>
        )}
      </div>
    </div>
  );
}

function AddEligibility({
  domains,
}: {
  domains: Array<{ id: string; displayName: string }>;
}) {
  const fetcher = useFetcher();
  const [open, setOpen] = useState(false);
  const [domainId, setDomainId] = useState("");
  const [level, setLevel] = useState<Level>("P1");
  const submitting = fetcher.state !== "idle";
  const wasSubmitting = useRef(false);

  // Collapse + clear the form after a successful submit.
  useEffect(() => {
    if (submitting) {
      wasSubmitting.current = true;
    } else if (wasSubmitting.current) {
      wasSubmitting.current = false;
      setOpen(false);
      setDomainId("");
      setLevel("P1");
    }
  }, [submitting]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-muted text-muted-foreground hover:bg-muted"
      >
        <Plus className="w-3 h-3" />
        Add domain
      </button>
    );
  }

  return (
    <fetcher.Form method="post" className="flex items-end gap-2">
      <input type="hidden" name="intent" value="add-eligibility" />
      <label className="flex flex-col gap-1 text-xs flex-1">
        <span className="text-muted-foreground">Domain</span>
        <select
          name="domainId"
          value={domainId}
          onChange={(e) => setDomainId(e.target.value)}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          required
        >
          <option value="">Select a domain…</option>
          {domains.map((d) => (
            <option key={d.id} value={d.id}>{d.displayName}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Level</span>
        <select
          name="level"
          value={level}
          onChange={(e) => setLevel(e.target.value as Level)}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        >
          {ALLOWED_LEVELS.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={submitting || !domainId}
        className="px-3 py-1.5 text-sm rounded-md bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50"
      >
        Add
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setDomainId(""); }}
        className="px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        Cancel
      </button>
    </fetcher.Form>
  );
}

function Field({
  name,
  label,
  defaultValue,
  readOnly,
  type = "text",
}: {
  name: string;
  label: string;
  defaultValue: string;
  readOnly: boolean;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {readOnly ? (
        <span className="px-2 py-1.5 text-sm text-foreground min-h-[34px] break-words">
          {defaultValue || "—"}
        </span>
      ) : (
        <input
          name={name}
          type={type}
          defaultValue={defaultValue}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
      )}
    </label>
  );
}
