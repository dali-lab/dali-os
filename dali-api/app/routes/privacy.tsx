// Public privacy policy. Required for Google OAuth verification — Google's
// reviewer loads this URL while validating the consent screen, so it must be
// (a) reachable without authentication and (b) explicitly describe what the
// app does with each requested Google scope. Keep the Google Calendar /
// Gmail sections accurate against app/lib/google-calendar.ts and
// app/lib/gmail.ts — if those change, update this page in the same PR.

import type { Route } from "./+types/privacy";
import { APPLICATIONS_FROM_EMAIL } from "~/lib/app-env";

export const meta: Route.MetaFunction = () => [
  { title: "Privacy Policy · DALI OS" },
];

const LAST_UPDATED = "May 20, 2026";

export default function PrivacyPolicy() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-foreground">
      <h1 className="font-heading text-3xl font-bold">Privacy Policy</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Last updated: {LAST_UPDATED}
      </p>

      <Section title="Who this applies to">
        <p>
          DALI OS is an internal tool operated by the{" "}
          <a
            href="https://dali.dartmouth.edu"
            className="text-accent-coral underline"
          >
            DALI Lab
          </a>{" "}
          at Dartmouth College. This policy covers the data the application
          collects, stores, and transmits when you sign in or link a Google
          account.
        </p>
      </Section>

      <Section title="What we collect">
        <ul className="list-disc pl-6 space-y-1.5">
          <li>
            <strong>Account profile</strong>: your name, Dartmouth or DALI
            email address, and profile photo, used to identify you inside the
            app.
          </li>
          <li>
            <strong>Membership and role data</strong>: your team assignments,
            domain eligibility, lab role, and project participation — managed
            by DALI staff and used to scope what you can see and do in the
            app.
          </li>
          <li>
            <strong>Work content you create</strong>: forms, tasks, comments,
            announcements, documents, and similar artifacts you author or
            collaborate on within the app.
          </li>
          <li>
            <strong>Google account data</strong> (only if you choose to link a
            Google account — see the next section).
          </li>
        </ul>
      </Section>

      <Section title="Google account data (Calendar)">
        <p>
          You can optionally link a Google account so the app can read your
          calendar availability and create meetings on your behalf. When you
          authorize this, the application requests the OAuth scope{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
            https://www.googleapis.com/auth/calendar
          </code>{" "}
          and uses it to:
        </p>
        <ul className="list-disc pl-6 space-y-1.5 mt-2">
          <li>
            <strong>Read your free/busy times</strong> across your linked
            calendars to find mutual availability when scheduling meetings
            with other lab members. The app reads busy time blocks only — it
            does not read event titles, descriptions, attendee identities, or
            attachments.
          </li>
          <li>
            <strong>List your calendars</strong> (id and display name only) so
            you can choose which calendar should receive new events the app
            creates.
          </li>
          <li>
            <strong>Create calendar events</strong> when you or another lab
            member schedules a meeting through the app, and update those
            events' attendee response status as members RSVP.
          </li>
        </ul>
        <p className="mt-3">
          The app does <strong>not</strong> read, modify, or delete calendar
          events that it did not create. It does not access any other Google
          service through your linked account beyond the scopes listed above.
        </p>
      </Section>

      <Section title="Google account data (Gmail)">
        <p>
          A single shared lab account (
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {APPLICATIONS_FROM_EMAIL}
          </code>
          ) is authorized with the scope{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
            https://www.googleapis.com/auth/gmail.send
          </code>{" "}
          so the application can send transactional email — interview
          invitations, decision notifications, and similar lab correspondence
          — from that single address. The app does not read inboxes, list
          messages, or access any user's personal Gmail.
        </p>
      </Section>

      <Section title="How we store Google tokens">
        <p>
          OAuth access and refresh tokens issued to the application are
          encrypted with AES-256-GCM before being written to the database. The
          encryption key is held only in the deployment's runtime environment
          and is not stored alongside the tokens. Tokens are scoped to your
          user record and are deleted when you disconnect the integration or
          when an administrator removes you from the lab.
        </p>
      </Section>

      <Section title="How we use this data">
        <ul className="list-disc pl-6 space-y-1.5">
          <li>To authenticate you and authorize what you can do in the app.</li>
          <li>
            To display lab content (projects, tasks, applications, calendars,
            announcements) to the people who should see it.
          </li>
          <li>
            To schedule and update calendar events you participate in, when
            you have opted in to the Google Calendar integration.
          </li>
          <li>
            To send transactional email from the lab's shared account
            (interview invitations, decisions, scheduling confirmations).
          </li>
        </ul>
        <p className="mt-3">
          We do <strong>not</strong> use your data for advertising, profiling,
          training machine-learning models, or sale to third parties.
        </p>
      </Section>

      <Section title="Who we share data with">
        <p>
          DALI OS data is not sold or shared with third parties for marketing.
          The application relies on the following processors, each handling
          only the data needed to perform its function:
        </p>
        <ul className="list-disc pl-6 space-y-1.5 mt-2">
          <li>
            <strong>Neon</strong> — managed PostgreSQL hosting (all
            application data).
          </li>
          <li>
            <strong>Fly.io</strong> — application hosting and request
            handling.
          </li>
          <li>
            <strong>Google</strong> — Calendar / Gmail APIs (only for accounts
            you have linked or, in the case of Gmail, the shared lab account).
          </li>
          <li>
            <strong>AWS S3</strong> — file uploads attached to forms and
            applications.
          </li>
          <li>
            <strong>Slack</strong> — optional notifications routed to a
            member's Slack DM, if a Slack user id is on file.
          </li>
        </ul>
      </Section>

      <Section title="How to revoke access">
        <p>
          You can disconnect your linked Google account at any time from{" "}
          <a href="/settings/connected-apps" className="text-accent-coral underline">
            Settings → Connected Apps
          </a>{" "}
          inside DALI OS. Doing so deletes the stored tokens for that account
          and stops the application from making Calendar API calls on your
          behalf.
        </p>
        <p className="mt-3">
          You can also revoke the application's access directly from your
          Google account at{" "}
          <a
            href="https://myaccount.google.com/permissions"
            className="text-accent-coral underline"
            rel="noreferrer"
          >
            myaccount.google.com/permissions
          </a>
          . Revoking there invalidates the stored tokens immediately; the next
          API call from the app will fail and the integration will be marked
          disconnected.
        </p>
      </Section>

      <Section title="Data retention">
        <p>
          Account, membership, and content data persists for as long as you
          are an active or alumni member of the DALI Lab. Google OAuth tokens
          are deleted when you disconnect the integration. Application logs
          containing request metadata are retained for up to 30 days for
          operational purposes.
        </p>
      </Section>

      <Section title="How to request deletion">
        <p>
          To request deletion of your data, email{" "}
          <a
            href="mailto:staff@dali.dartmouth.edu"
            className="text-accent-coral underline"
          >
            staff@dali.dartmouth.edu
          </a>
          . We will remove identifying account information within 30 days,
          subject to records the Lab is required to retain for academic or
          administrative reasons.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          When this policy changes in a material way, we will update the "Last
          updated" date at the top and, where appropriate, notify active users
          in-app. Earlier versions are available in the application's source
          repository.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about this policy or how DALI OS handles your data:{" "}
          <a
            href="mailto:staff@dali.dartmouth.edu"
            className="text-accent-coral underline"
          >
            staff@dali.dartmouth.edu
          </a>
          .
        </p>
      </Section>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold mb-2">{title}</h2>
      <div className="text-sm leading-relaxed text-foreground/90 space-y-2">
        {children}
      </div>
    </section>
  );
}
