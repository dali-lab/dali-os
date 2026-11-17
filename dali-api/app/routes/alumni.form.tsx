import { Form, Link, redirect, useLoaderData, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/alumni.form";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db.server";
import { readOnlyRoles } from "~/lib/read-only-roles.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import {
  addHistoryNote,
  addQuestWorkExperience,
  confirmQuestField,
  loadDaliHistoryLines,
  setOpenTo,
} from "~/lib/alumni-game.server";
import {
  updateProfileFields,
  ProfileValidationError,
  ProfileConflictError,
} from "~/members/lib/profile-update.server";
import { FormField } from "~/components/ui/FormField";
import { DateField } from "~/components/ui/DateField";
import { Radio } from "~/components/ui/Radio";
import { Toggle } from "~/components/ui/Toggle";
import { Button } from "~/components/ui/Button";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";

export const meta: Route.MetaFunction = () => [{ title: "Your profile · DALI OS" }];

async function requireAlumniFormAccess(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  const userId = auth.user.sub;
  const roles = await readOnlyRoles(userId, request);
  if (!roles.isLabMemberOrAlum) throw redirect("/");
  if (!(await isFeatureEnabled("alumni-game", userId, roles, request))) throw redirect("/");
  return userId;
}

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireAlumniFormAccess(request);
  const [user, historyLines, workCount] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        firstName: true,
        lastName: true,
        daliEmail: true,
        dartmouthEmail: true,
        personalEmail: true,
        preferredEmail: true,
        classYear: true,
        currentLocation: true,
        hometown: true,
        birthday: true,
        major: true,
        minors: true,
        funFact: true,
        dietaryRestrictions: true,
        linkedinUrl: true,
        personalSite: true,
        openToCoffeeChats: true,
        openToResumeReviews: true,
        openToPortfolioReviews: true,
      },
    }),
    loadDaliHistoryLines(userId),
    prisma.workExperience.count({ where: { userId } }),
  ]);
  return {
    user: {
      ...user,
      birthday: user.birthday ? user.birthday.toISOString().slice(0, 10) : "",
      classYear: user.classYear?.toString() ?? "",
    },
    historyLines,
    hasWork: workCount > 0,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireAlumniFormAccess(request);
  const form = await request.formData();
  const text = (field: string) => String(form.get(field) ?? "").trim();

  const personalEmail = text("personalEmail");
  const preferredPick = text("preferredPick");
  const preferredEmail = preferredPick === "personal" ? personalEmail : preferredPick;

  try {
    await updateProfileFields(
      userId,
      {
        firstName: text("firstName"),
        lastName: text("lastName"),
        personalEmail,
        preferredEmail,
        classYear: text("classYear"),
        currentLocation: text("currentLocation"),
        hometown: text("hometown"),
        birthday: text("birthday"),
        major: text("major"),
        minors: text("minors"),
        funFact: text("funFact"),
        dietaryRestrictions: text("dietaryRestrictions"),
        linkedinUrl: text("linkedinUrl"),
        personalSite: text("personalSite"),
      },
      { allowNetId: false },
    );
  } catch (e) {
    if (e instanceof ProfileValidationError || e instanceof ProfileConflictError) {
      return { error: e.message };
    }
    throw e;
  }

  const position = text("workPosition");
  const company = text("workCompany");
  if (position !== "" && company !== "") {
    await addQuestWorkExperience(userId, company, position);
  }

  const historyNote = text("historyNote");
  if (historyNote !== "") await addHistoryNote(userId, historyNote);

  await setOpenTo(userId, {
    coffeeChats: form.get("openToCoffeeChats") === "on",
    resumeReviews: form.get("openToResumeReviews") === "on",
    portfolioReviews: form.get("openToPortfolioReviews") === "on",
  });

  const confirms = ["name", "openTo", "history"];
  if (preferredEmail !== "") confirms.push("email");
  if (position !== "" && company !== "") confirms.push("work");
  for (const key of confirms) await confirmQuestField(userId, key);

  return redirect("/profile");
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  const { heading } = useOsChrome();
  return <h2 className={heading}>{children}</h2>;
}

export default function AlumniForm() {
  const { user, historyLines, hasWork } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const { card, formClass, pageTitle } = useOsChrome();

  const onFile = [user.daliEmail, user.dartmouthEmail].filter(
    (e): e is string => typeof e === "string" && e !== "",
  );
  const preferredDefault = (() => {
    const wanted = user.preferredEmail?.toLowerCase();
    if (!wanted) return onFile[0] ?? "personal";
    const match = onFile.find((e) => e.toLowerCase() === wanted);
    if (match) return match;
    return "personal";
  })();

  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className={pageTitle}>Fill in your alumni profile</h1>
          <p className="text-sm text-os-grey">
            The quick version of Tim's quest. Save at the bottom, then give your profile a
            once-over.
          </p>
        </header>

        {actionData?.error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {actionData.error}
          </div>
        )}

        <Form method="post" className={cn(formClass, "flex flex-col gap-6")}>
          <section className={cn(card, "flex flex-col gap-4 p-5")}>
            <SectionTitle>Name</SectionTitle>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="First name" name="firstName" defaultValue={user.firstName} required />
              <FormField label="Last name" name="lastName" defaultValue={user.lastName} required />
            </div>
          </section>

          <section className={cn(card, "flex flex-col gap-4 p-5")}>
            <SectionTitle>Email</SectionTitle>
            <p className="text-sm text-os-grey">Pick the address you want us to reach you at.</p>
            <div className="flex flex-col gap-2.5">
              {onFile.map((email) => (
                <Radio
                  key={email}
                  name="preferredPick"
                  value={email}
                  defaultChecked={preferredDefault === email}
                  label={email}
                />
              ))}
              <div className="flex flex-col gap-2">
                <Radio
                  name="preferredPick"
                  value="personal"
                  defaultChecked={preferredDefault === "personal"}
                  label="A personal email"
                />
                <div className="pl-6">
                  <FormField
                    label="Personal email"
                    labelHidden
                    name="personalEmail"
                    type="email"
                    defaultValue={user.personalEmail ?? ""}
                    placeholder="you@example.com"
                  />
                </div>
              </div>
            </div>
          </section>

          <section className={cn(card, "flex flex-col gap-4 p-5")}>
            <SectionTitle>About you</SectionTitle>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Class year" name="classYear" defaultValue={user.classYear} placeholder="2019" />
              <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
                Birthday
                <DateField mode="date" name="birthday" defaultValue={user.birthday} ariaLabel="Birthday" />
              </label>
              <FormField label="Major" name="major" defaultValue={user.major ?? ""} />
              <FormField label="Minors" name="minors" defaultValue={user.minors ?? ""} />
              <FormField label="Hometown" name="hometown" defaultValue={user.hometown ?? ""} />
              <FormField
                label="Based in"
                name="currentLocation"
                defaultValue={user.currentLocation ?? ""}
                placeholder="City, state or country"
              />
            </div>
            <FormField
              label="Dietary restrictions"
              name="dietaryRestrictions"
              defaultValue={user.dietaryRestrictions ?? ""}
              hint="For when we feed you at alumni events."
            />
            <FormField
              label="Ask me about"
              name="funFact"
              defaultValue={user.funFact ?? ""}
              multiline
              rows={2}
              hint="A fun fact or something people should ask you about."
            />
          </section>

          <section className={cn(card, "flex flex-col gap-4 p-5")}>
            <SectionTitle>Links</SectionTitle>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                label="LinkedIn"
                name="linkedinUrl"
                type="url"
                defaultValue={user.linkedinUrl ?? ""}
                placeholder="https://linkedin.com/in/..."
              />
              <FormField
                label="Personal site"
                name="personalSite"
                type="url"
                defaultValue={user.personalSite ?? ""}
                placeholder="https://..."
              />
            </div>
          </section>

          <section className={cn(card, "flex flex-col gap-4 p-5")}>
            <SectionTitle>Work</SectionTitle>
            {hasWork && (
              <p className="text-sm text-os-grey">
                You already have work experience on file. Add your current job here, or manage
                the full list on your profile.
              </p>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Role" name="workPosition" placeholder="Designer" />
              <FormField label="Company" name="workCompany" placeholder="Google" />
            </div>
          </section>

          <section className={cn(card, "flex flex-col gap-4 p-5")}>
            <SectionTitle>Your DALI history</SectionTitle>
            {historyLines.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {historyLines.map((line) => (
                  <li
                    key={line}
                    className="rounded-os-item bg-os-well px-3 py-2 text-sm text-foreground"
                  >
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-os-muted italic">Nothing on file yet.</p>
            )}
            <FormField
              label="Anything off?"
              name="historyNote"
              multiline
              rows={2}
              hint="Tell us what's wrong or missing and we'll fix it."
            />
          </section>

          <section className={cn(card, "flex flex-col gap-4 p-5")}>
            <SectionTitle>Open to</SectionTitle>
            <p className="text-sm text-os-grey">What current members can ask you for.</p>
            <Toggle tone="os" name="openToCoffeeChats" label="Coffee chats" defaultChecked={user.openToCoffeeChats} />
            <Toggle tone="os" name="openToResumeReviews" label="Resume reviews" defaultChecked={user.openToResumeReviews} />
            <Toggle
              tone="os"
              name="openToPortfolioReviews"
              label="Portfolio reviews"
              defaultChecked={user.openToPortfolioReviews}
            />
          </section>

          <div className="flex items-center justify-between gap-3">
            <Link to="/alumni/welcome" className="text-sm text-os-grey hover:text-foreground">
              ← Back
            </Link>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save and view my profile"}
            </Button>
          </div>
        </Form>
      </div>
    </main>
  );
}
