import { Form, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/portal.settings";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isValidTimezone } from "~/lib/timezone";
import { AppearanceSettingsBlock } from "~/components/settings/AppearanceSettingsBlock";

export const meta: Route.MetaFunction = () => [{ title: "Settings · DALI OS" }];

// Applicant settings — same shape as partner settings, student content. CAS
// hands us legal names, so editable first/last (preferred name), pronouns,
// and a phone number for interview scheduling are the fields that matter.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const me = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: {
      firstName: true,
      lastName: true,
      pronouns: true,
      phoneNumber: true,
      classYear: true,
      major: true,
      timeZone: true,
    },
  });
  if (!me) return redirectToLogin(request);
  return { me };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);

  const form = await request.formData();
  const firstName = (form.get("firstName") as string | null)?.trim() ?? "";
  const lastName = (form.get("lastName") as string | null)?.trim() ?? "";
  if (!firstName || !lastName) {
    return { error: "First and last name are required." };
  }
  const classYearRaw = (form.get("classYear") as string | null)?.trim();
  const classYear = classYearRaw ? Number.parseInt(classYearRaw, 10) : null;
  if (classYearRaw && (Number.isNaN(classYear!) || classYear! < 2000 || classYear! > 2100)) {
    return { error: "Enter a valid class year (e.g. 2027)." };
  }
  const tzRaw = (form.get("timeZone") as string | null)?.trim() || null;
  const timeZone = tzRaw && isValidTimezone(tzRaw) ? tzRaw : null;
  await prisma.user.update({
    where: { id: auth.user.sub },
    data: {
      firstName,
      lastName,
      pronouns: (form.get("pronouns") as string | null)?.trim() || null,
      phoneNumber: (form.get("phoneNumber") as string | null)?.trim() || null,
      classYear,
      major: (form.get("major") as string | null)?.trim() || null,
      timeZone,
    },
  });
  return { ok: true };
}

export default function PortalSettings({ actionData }: Route.ComponentProps) {
  const { me } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const error = actionData && "error" in actionData ? actionData.error : null;

  const inputClass =
    "w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral";
  const labelClass = "block text-xs font-medium text-muted-foreground mb-1";
  const saveClass =
    "self-start rounded-xl bg-dark-blue text-white text-sm font-heading font-semibold px-5 py-2.5 hover:opacity-90 transition disabled:opacity-50";

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-8">
      <h1 className="font-heading text-3xl font-bold text-dark-blue">Settings</h1>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>
      )}

      <section className="bg-card border border-border rounded-2xl p-5">
        <h2 className="font-heading font-semibold text-dark-blue mb-4">Profile</h2>
        <Form method="post" className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="firstName" className={labelClass}>
                First name
              </label>
              <input
                id="firstName"
                name="firstName"
                required
                defaultValue={me.firstName ?? ""}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="lastName" className={labelClass}>
                Last name
              </label>
              <input
                id="lastName"
                name="lastName"
                required
                defaultValue={me.lastName ?? ""}
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label htmlFor="pronouns" className={labelClass}>
              Pronouns
            </label>
            <input
              id="pronouns"
              name="pronouns"
              placeholder="e.g. they/them"
              defaultValue={me.pronouns ?? ""}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="phoneNumber" className={labelClass}>
              Phone number
            </label>
            <input
              id="phoneNumber"
              name="phoneNumber"
              type="tel"
              placeholder="For interview scheduling"
              defaultValue={me.phoneNumber ?? ""}
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="classYear" className={labelClass}>
                Class year
              </label>
              <input
                id="classYear"
                name="classYear"
                type="number"
                min={2000}
                max={2100}
                placeholder="e.g. 2027"
                defaultValue={me.classYear ?? ""}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="major" className={labelClass}>
                Major
              </label>
              <input
                id="major"
                name="major"
                placeholder="e.g. Computer Science"
                defaultValue={me.major ?? ""}
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label htmlFor="timeZone" className={labelClass}>
              Time zone
            </label>
            <select
              id="timeZone"
              name="timeZone"
              defaultValue={me.timeZone ?? "America/New_York"}
              className={inputClass}
            >
              {Intl.supportedValuesOf("timeZone").map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Session times across the portal show in this zone.
            </p>
          </div>
          <button type="submit" disabled={submitting} className={saveClass}>
            Save profile
          </button>
        </Form>
      </section>

      <section className="bg-card border border-border rounded-2xl p-5">
        <h2 className="font-heading font-semibold text-dark-blue mb-4">Appearance</h2>
        <AppearanceSettingsBlock />
      </section>
    </main>
  );
}
