import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/education.offerings.$id.apply";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { ApplicationForm } from "~/education/components/ApplicationForm";

export const meta: Route.MetaFunction = () => [{ title: "Apply · Education" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect(`/portal/education/${params.id}/apply`);

  const offering = await prisma.educationOffering.findUnique({
    where: { id: params.id },
    select: { id: true, title: true, status: true, registrationOpensAt: true, registrationClosesAt: true },
  });
  if (!offering) throw new Response("Not found", { status: 404 });
  if (offering.status !== "Published") {
    return redirect(`/education/offerings/${offering.id}`);
  }
  const now = new Date();
  if (now < offering.registrationOpensAt || now > offering.registrationClosesAt) {
    return redirect(`/education/offerings/${offering.id}`);
  }

  const [questions, existing] = await Promise.all([
    prisma.educationApplicationQuestion.findMany({
      where: { offeringId: offering.id },
      orderBy: { position: "asc" },
    }),
    prisma.educationApplication.findUnique({
      where: { applicantUserId_offeringId: { applicantUserId: auth.user.sub, offeringId: offering.id } },
      include: { answers: true },
    }),
  ]);

  const initial: Record<string, string> = {};
  if (existing) {
    for (const a of existing.answers) initial[a.questionId] = a.content;
  }

  return {
    offering: { id: offering.id, title: offering.title },
    questions: questions.map((q) => ({ id: q.id, prompt: q.prompt, required: q.required, type: q.type as "Text" | "Url" | "File" })),
    initialAnswers: initial,
  };
}

export default function Apply() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className="p-6 md:p-10">
      <ApplicationForm
        offeringId={data.offering.id}
        offeringTitle={data.offering.title}
        questions={data.questions}
        initialAnswers={data.initialAnswers}
        submitTo={`/api/education/offerings/${data.offering.id}/applications`}
        redirectAfter={`/education/offerings/${data.offering.id}`}
      />
    </div>
  );
}
