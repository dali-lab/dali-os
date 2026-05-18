import { Form, redirect, useActionData } from "react-router";
import type { Route } from "./+types/education.offerings.new";
import { requireAuth } from "~/lib/auth";
import { isCore, currentTerm } from "~/lib/roles";
import { prisma } from "~/lib/db";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) {
    return new Response("Forbidden", { status: 403 });
  }
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) {
    return new Response("Forbidden", { status: 403 });
  }
  const fd = await request.formData();
  const title = String(fd.get("title") || "").trim();
  const type = String(fd.get("type") || "Miniseries") as "Miniseries" | "Workshop";
  const capacity = Number(fd.get("capacity") || 20);
  const requiresReview = fd.get("requiresReview") === "on";
  const registrationOpensAt = String(fd.get("registrationOpensAt") || "");
  const registrationClosesAt = String(fd.get("registrationClosesAt") || "");
  const startsAt = String(fd.get("startsAt") || "");
  const endsAt = String(fd.get("endsAt") || "");
  if (!title || !registrationOpensAt || !registrationClosesAt || !startsAt || !endsAt) {
    return { error: "All fields required" };
  }
  const offering = await prisma.educationOffering.create({
    data: {
      title,
      type,
      capacity,
      requiresReview,
      registrationOpensAt: new Date(registrationOpensAt),
      registrationClosesAt: new Date(registrationClosesAt),
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      status: "Draft",
    },
  });
  const term = await currentTerm();
  if (term) {
    await prisma.instructorAssignment.create({
      data: {
        userId: auth.user.sub,
        offeringId: offering.id,
        termId: term.id,
      },
    });
  }
  return redirect(`/education/offerings/${offering.id}/settings`);
}

export default function NewOffering() {
  const data = useActionData<typeof action>();
  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="font-heading text-2xl font-bold text-dark-blue mb-6">
        New Offering
      </h1>
      <Form method="post" className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-dark-blue">Title</span>
          <input
            name="title"
            required
            className="mt-1 block w-full border border-border rounded-md px-3 py-2 text-sm"
          />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium text-dark-blue">Type</span>
            <select
              name="type"
              className="mt-1 block w-full border border-border rounded-md px-3 py-2 text-sm bg-white"
            >
              <option value="Miniseries">Miniseries</option>
              <option value="Workshop">Workshop</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-dark-blue">Capacity</span>
            <input
              type="number"
              name="capacity"
              min={1}
              defaultValue={20}
              className="mt-1 block w-full border border-border rounded-md px-3 py-2 text-sm"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="requiresReview" defaultChecked />
          <span>Requires instructor review (Miniseries default)</span>
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium text-dark-blue">Registration opens</span>
            <input
              type="datetime-local"
              name="registrationOpensAt"
              required
              className="mt-1 block w-full border border-border rounded-md px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-dark-blue">Registration closes</span>
            <input
              type="datetime-local"
              name="registrationClosesAt"
              required
              className="mt-1 block w-full border border-border rounded-md px-3 py-2 text-sm"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium text-dark-blue">Starts</span>
            <input
              type="datetime-local"
              name="startsAt"
              required
              className="mt-1 block w-full border border-border rounded-md px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-dark-blue">Ends</span>
            <input
              type="datetime-local"
              name="endsAt"
              required
              className="mt-1 block w-full border border-border rounded-md px-3 py-2 text-sm"
            />
          </label>
        </div>
        {data?.error && (
          <p className="text-sm text-red-600">{data.error}</p>
        )}
        <button
          type="submit"
          className="px-4 py-2 bg-accent-coral text-white text-sm font-medium rounded-md hover:opacity-90"
        >
          Create draft
        </button>
      </Form>
    </div>
  );
}
