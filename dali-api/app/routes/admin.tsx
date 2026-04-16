import { useState } from "react";
import { Form, Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/admin";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { ChevronRight, Plus, X } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  Draft: "Draft",
  Open: "Open",
  UnderReview: "Under Review",
  Completed: "Completed",
};

const STATUS_COLORS: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-700",
  Open: "bg-green-100 text-green-700",
  UnderReview: "bg-yellow-100 text-yellow-700",
  Completed: "bg-blue-100 text-blue-700",
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isHiringLead(auth.user.sub))) return redirect("/");

  const cycles = await prisma.applicationCycle.findMany({
    include: {
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
      domains: { include: { domain: true } },
      _count: { select: { applications: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return { cycles };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const name = (formData.get("name") as string)?.trim();
  if (!name) return { error: "Name is required" };

  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isHiringLead(auth.user.sub))) return redirect("/");
  const adminUser = await prisma.user.findUniqueOrThrow({
    where: { id: auth.user.sub },
  });

  const cycle = await prisma.applicationCycle.create({
    data: {
      name,
      statusUpdates: {
        create: { newStatus: "Draft", userId: adminUser.id },
      },
    },
  });

  return redirect(`/hiring-lead-admin/cycle/${cycle.id}`);
}

export default function AdminDashboard() {
  const data = useLoaderData<typeof loader>() as any;
  const cycles = data?.cycles ?? [];
  const [showModal, setShowModal] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Hiring Cycles</h1>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <Plus className="w-4 h-4" />
          New Cycle
        </button>
      </div>

      {showModal && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">New Hiring Cycle</h2>
                <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <Form method="post" onSubmit={() => setShowModal(false)} className="space-y-4">
                <div>
                  <label htmlFor="cycle-name" className="block text-sm font-medium text-gray-700 mb-1">
                    Cycle name
                  </label>
                  <input
                    id="cycle-name"
                    name="name"
                    placeholder="e.g. Fall 2027"
                    required
                    autoFocus
                    autoComplete="off"
                    className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                  >
                    Create
                  </button>
                </div>
              </Form>
            </div>
          </div>
        </>
      )}


      {cycles.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-500">
          No cycles yet.
        </div>
      ) : (
        <div className="space-y-3">
          {cycles.map((cycle: any) => {
            const currentStatus = cycle.statusUpdates[0]?.newStatus ?? "Draft";
            const domains = cycle.domains.map((d: any) => d.domain.name);
            return (
              <Link
                key={cycle.id}
                to={`/hiring-lead-admin/cycle/${cycle.id}`}
                className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-6 py-4 hover:bg-gray-50 transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-gray-900">{cycle.name}</span>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[currentStatus]}`}>
                      {STATUS_LABELS[currentStatus]}
                    </span>
                  </div>
                  <div className="text-sm text-gray-500">
                    {domains.join(", ") || "No domains"} · {cycle._count.applications} application{cycle._count.applications !== 1 ? "s" : ""}
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
