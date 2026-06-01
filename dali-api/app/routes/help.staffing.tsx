import { Link } from "react-router";
import type { Route } from "./+types/help.staffing";

export const meta: Route.MetaFunction = () => [
  { title: "Staffing · Help · DALI OS" },
];

export default function HelpStaffingPage() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Staffing</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Each term the lab runs a staffing cycle that places members onto
        projects. Three forms drive what you tell us; the staffing board does
        the rest.
      </p>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Intent to Work</h2>
        <p className="mt-2 text-sm text-zinc-700">
          Tell us whether you're on this term at all, what domain you're
          working in, and the role level you're available at. If you're off-term
          (DPlan, leave, foreign study) this is where you say so. Submitting
          intent is what keeps you in the pool — no intent means no placement.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Project bids</h2>
        <p className="mt-2 text-sm text-zinc-700">
          Rank up to three project / role openings you'd most like to work on.
          The options you see are the openings you're eligible for, based on
          your domain and level. Bids are private to staffing leads and PMs of
          the projects you bid on.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Level-up</h2>
        <p className="mt-2 text-sm text-zinc-700">
          If you want to move up a role level this term (e.g. Developer →
          Senior Developer), submit a level-up request. Your domain lead
          reviews these alongside staffing — promotions land before
          assignments are locked.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">How placements happen</h2>
        <p className="mt-2 text-sm text-zinc-700">
          PMs mark which roles on their project are essential to ship the
          term. Staffing leads run a two-phase lock: essential roles get
          placed first to make sure every project can launch, then the rest
          of the lab is paired into preferences. When the board closes,
          assignments are published and you'll see them on your profile and
          the project page.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">After placement</h2>
        <p className="mt-2 text-sm text-zinc-700">
          Your assignments show up on{" "}
          <Link to="/profile" className="text-blue-700 underline">
            your profile
          </Link>{" "}
          for the current term. If you have a conflict with a placement,
          flag it to staffing leads early — swapping later is harder than
          adjusting before the close.
        </p>
      </section>
    </main>
  );
}
