import { useEffect, useRef } from "react";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import type { Route } from "./+types/members.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { initialsFromName } from "~/lib/display";
import { resolvePhotoUrl } from "~/lib/photo";
import { EditableSection } from "~/components/EditableSection";
import { PhotoUploadField } from "~/components/PhotoUploadField";

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
    },
  });
  if (!member) throw new Response("Not found", { status: 404 });

  // Editable by admins, or the member viewing their own profile.
  const admin = await isAdmin(auth.user.sub);
  const canEdit = admin || auth.user.sub === member.id;

  // Resolve for the header <img>. The raw key stays on `member.photoUrl` so
  // the upload field's hidden input round-trips it unchanged on save.
  const photoUrlResolved = await resolvePhotoUrl(member.photoUrl);

  return { member, canEdit, photoUrlResolved };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");

  const admin = await isAdmin(auth.user.sub);
  if (!admin && auth.user.sub !== params.id) {
    return { error: "You don't have permission to edit this member." };
  }

  const form = await request.formData();

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
  const { member, canEdit, photoUrlResolved } = useLoaderData<typeof loader>();
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
    </div>
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
