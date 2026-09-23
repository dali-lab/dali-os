import { useRef, useState } from "react";
import { Form, useNavigation, useSubmit } from "react-router";
import {
  Clock,
  GraduationCap,
  Mail,
  Pencil,
  Phone,
  User as UserIcon,
  UsersRound,
} from "lucide-react";
import { DetailEditRow, DetailRow, OS_DETAIL_ICON } from "~/components/os-page";
import { PhotoUploadField } from "~/components/PhotoUploadField";
import { buttonClasses } from "~/components/ui/Button";
import { formatZoneLabel } from "~/lib/timezone";
import type { PortalProfileData } from "~/lib/portal-profile.server";

// The applicant's profile, as the member profile states one: a hairlined facts
// card that reads label-left / value-right, with an Edit toggle that swaps each
// value for its field. Shared by the portal home (read-first, the photo living
// in the page hero) and /portal/settings (`alwaysEditing`, with the photo field
// inline since that page has no hero).

const CARD = "rounded-2xl border border-border bg-card px-5 shadow-brand-1";
const FIELD =
  "w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral";

function Dash() {
  return <span className="text-muted-foreground">—</span>;
}

// Full IANA zone list from the runtime's ICU data — identical in Node (SSR) and
// the browser, so the rendered <option> set is stable across hydration.
function timeZoneOptions(): string[] {
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    if (zones.length) return zones;
  } catch {
    // fall through
  }
  return ["America/New_York"];
}

function ProfileRead({ profile, email }: Pick<PortalProfileData, "profile" | "email">) {
  const ic = OS_DETAIL_ICON;
  return (
    <div className={CARD}>
      <DetailRow icon={<Mail className={ic} />} label="Email">
        <span className="break-all">{email || <Dash />}</span>
      </DetailRow>
      <DetailRow icon={<UsersRound className={ic} />} label="Pronouns">
        {profile.pronouns ?? <Dash />}
      </DetailRow>
      <DetailRow icon={<GraduationCap className={ic} />} label="Class year">
        {profile.classYear?.toString() ?? <Dash />}
      </DetailRow>
      <DetailRow icon={<GraduationCap className={ic} />} label="Major">
        {profile.major ?? <Dash />}
      </DetailRow>
      <DetailRow icon={<Phone className={ic} />} label="Phone">
        {profile.phoneNumber ?? <Dash />}
      </DetailRow>
      <DetailRow icon={<Clock className={ic} />} label="Time zone">
        {profile.timeZone ? formatZoneLabel(profile.timeZone) : <Dash />}
      </DetailRow>
    </div>
  );
}

// Every field the save writes is rendered — that write replaces the whole set,
// so a field left out of the form would be cleared rather than kept.
function ProfileEdit({
  data,
  withPhotoField,
}: {
  data: PortalProfileData;
  withPhotoField: boolean;
}) {
  const { profile, email, userId, photoPreviewUrl } = data;
  const ic = OS_DETAIL_ICON;
  return (
    <div className={CARD}>
      {withPhotoField && (
        <div className="border-b border-border py-4">
          <PhotoUploadField
            userId={userId}
            name={`${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim()}
            initialKey={profile.photoUrl}
            initialPreviewUrl={photoPreviewUrl}
            readOnly={false}
          />
        </div>
      )}

      <DetailEditRow icon={<UserIcon className={ic} />} label="First name">
        <input
          name="firstName"
          aria-label="First name"
          required
          defaultValue={profile.firstName ?? ""}
          className={FIELD}
        />
      </DetailEditRow>

      <DetailEditRow icon={<UserIcon className={ic} />} label="Last name">
        <input
          name="lastName"
          aria-label="Last name"
          required
          defaultValue={profile.lastName ?? ""}
          className={FIELD}
        />
      </DetailEditRow>

      <DetailEditRow
        icon={<Mail className={ic} />}
        label="Email"
        hint="The address you sign in with — it can't be changed here."
      >
        <input aria-label="Email" value={email} readOnly className={`${FIELD} bg-muted text-muted-foreground`} />
      </DetailEditRow>

      <DetailEditRow icon={<UsersRound className={ic} />} label="Pronouns">
        <input
          name="pronouns"
          aria-label="Pronouns"
          placeholder="e.g. they/them"
          defaultValue={profile.pronouns ?? ""}
          className={FIELD}
        />
      </DetailEditRow>

      <DetailEditRow icon={<GraduationCap className={ic} />} label="Class year">
        <input
          name="classYear"
          aria-label="Class year"
          type="number"
          min={2000}
          max={2100}
          placeholder="e.g. 2027"
          defaultValue={profile.classYear ?? ""}
          className={FIELD}
        />
      </DetailEditRow>

      <DetailEditRow icon={<GraduationCap className={ic} />} label="Major">
        <input
          name="major"
          aria-label="Major"
          placeholder="e.g. Computer Science"
          defaultValue={profile.major ?? ""}
          className={FIELD}
        />
      </DetailEditRow>

      <DetailEditRow
        icon={<Phone className={ic} />}
        label="Phone"
        hint="Used to reach you about interviews."
      >
        <input
          name="phoneNumber"
          aria-label="Phone"
          type="tel"
          defaultValue={profile.phoneNumber ?? ""}
          className={FIELD}
        />
      </DetailEditRow>

      <DetailEditRow
        icon={<Clock className={ic} />}
        label="Time zone"
        hint="Session times across the portal show in this zone."
      >
        <select
          name="timeZone"
          aria-label="Time zone"
          defaultValue={profile.timeZone ?? "America/New_York"}
          className={FIELD}
        >
          {timeZoneOptions().map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </DetailEditRow>
    </div>
  );
}

export function PortalProfileCard({
  data,
  error,
  saved,
  alwaysEditing = false,
}: {
  data: PortalProfileData;
  error?: string | null;
  /** Show the "Saved" confirmation after a round trip. */
  saved?: boolean;
  /** Skip the read view and the Edit toggle (used by /portal/settings). */
  alwaysEditing?: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  // Bumped on Cancel so the fields remount and drop the user's typing.
  const [resetKey, setResetKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const open = alwaysEditing || editing;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-heading text-[19px] font-semibold text-dark-blue">
          Profile
        </h2>
        <div className="flex items-center gap-3">
          {saved && !submitting && (
            <span className="text-xs font-medium text-muted-foreground">Saved</span>
          )}
          {!alwaysEditing &&
            (open ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setResetKey((k) => k + 1);
                    setEditing(false);
                  }}
                  disabled={submitting}
                  className={buttonClasses("ghost", "sm")}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    if (formRef.current) submit(formRef.current);
                    setEditing(false);
                  }}
                  className={buttonClasses("primary", "sm")}
                >
                  Save
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className={buttonClasses("secondary", "sm")}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
            ))}
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
      )}

      <Form method="post" ref={formRef} key={resetKey}>
        {open ? (
          <ProfileEdit data={data} withPhotoField={alwaysEditing} />
        ) : (
          <ProfileRead profile={data.profile} email={data.email} />
        )}
        {alwaysEditing && (
          <button
            type="submit"
            disabled={submitting}
            className={buttonClasses("primary", "md", "mt-4")}
          >
            Save profile
          </button>
        )}
      </Form>
    </section>
  );
}
