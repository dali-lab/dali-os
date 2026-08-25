import { redirect, Form, useActionData, useNavigation } from "react-router";
import { redirectToLogin } from "~/lib/login-next";
import type { Route } from "./+types/education.manage.new";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { runOfferingAction } from "~/education/lib/offerings.server";
import { Button } from "~/components/ui/Button";
import { OfferingFields } from "~/education/components/OfferingFields";

export const meta: Route.MetaFunction = () => [
  { title: "New Offering · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  // Creating an offering is Core-only — an instructor (member or external) lands
  // back on their manageable list.
  if (!(await isCore(auth.user.sub))) return redirect("/education/manage");
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) return forbidden(request);

  const formData = await request.formData();
  formData.set("intent", "create-offering");
  const result = await runOfferingAction(formData, auth.user.sub);
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  return redirect(`/education/manage/${result.id}`);
}

export default function NewOffering() {
  const actionData = useActionData<{ error?: string }>();
  const navigation = useNavigation();

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          New offering
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Offerings start as drafts — add sessions, a description, and an
          application form, then publish when it&apos;s ready to appear in the
          catalog.
        </p>
      </header>

      <Form method="post" className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
        <OfferingFields />
        {actionData?.error && (
          <p className="text-sm text-destructive">{actionData.error}</p>
        )}
        <div>
          <Button type="submit" disabled={navigation.state !== "idle"}>
            Create draft
          </Button>
        </div>
      </Form>
    </div>
  );
}
