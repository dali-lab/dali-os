// Public terms of service. Required for Google OAuth verification — paired
// with /privacy. Kept short and accurate; updates ride alongside changes to
// privacy.tsx.

import type { Route } from "./+types/terms";

export const meta: Route.MetaFunction = () => [
  { title: "Terms of Service · DALI OS" },
];

const LAST_UPDATED = "May 20, 2026";

export default function TermsOfService() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-foreground">
      <h1 className="font-heading text-3xl font-bold">Terms of Service</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Last updated: {LAST_UPDATED}
      </p>

      <Section title="About DALI OS">
        <p>
          DALI OS is an internal application operated by the{" "}
          <a
            href="https://dali.dartmouth.edu"
            className="text-accent-coral underline"
          >
            DALI Lab
          </a>{" "}
          at Dartmouth College for hiring, staffing, scheduling, and
          collaboration. It is provided to Lab members, applicants, and
          authorized partners for use in connection with Lab activities.
        </p>
      </Section>

      <Section title="Who may use it">
        <p>
          Access is granted by DALI Lab staff. By signing in you confirm that
          you are using a Dartmouth, DALI, or otherwise-authorized account
          extended to you for this purpose. Accounts may not be shared, and
          credentials may not be transferred.
        </p>
      </Section>

      <Section title="Acceptable use">
        <ul className="list-disc pl-6 space-y-1.5">
          <li>
            Use DALI OS only for Lab-related work and only for the purposes
            granted to your role.
          </li>
          <li>
            Do not attempt to access data or features outside the scope of
            your permissions, circumvent access controls, or interfere with
            the service.
          </li>
          <li>
            Do not upload content that violates Dartmouth's Acceptable Use
            Policy, the law, or another person's rights.
          </li>
          <li>
            Do not use the application to send unsolicited messages or
            otherwise misuse its email or calendar integrations.
          </li>
        </ul>
      </Section>

      <Section title="Your content">
        <p>
          You retain ownership of content you author through DALI OS. By
          using the application you grant the DALI Lab the right to store,
          display, and process that content as needed to operate the
          application and conduct Lab work.
        </p>
      </Section>

      <Section title="Privacy">
        <p>
          Use of DALI OS is also governed by our{" "}
          <a href="/privacy" className="text-accent-coral underline">
            Privacy Policy
          </a>
          , which describes what data the application collects and how it is
          handled — including the data accessed when you link a Google
          account.
        </p>
      </Section>

      <Section title="Third-party services">
        <p>
          DALI OS integrates with third-party services (Google, Slack, AWS,
          Neon, Fly.io, among others). Your use of those services through the
          application is also subject to their respective terms. Linking a
          Google account is optional; you can disconnect it at any time.
        </p>
      </Section>

      <Section title="Service availability and changes">
        <p>
          DALI OS is provided on an as-available basis. The Lab may modify,
          suspend, or discontinue features at any time, and may change these
          terms by updating this page and the "Last updated" date above.
          Continued use after a change constitutes acceptance of the updated
          terms.
        </p>
      </Section>

      <Section title="No warranty">
        <p>
          The application is provided "as is," without warranty of any kind,
          express or implied. To the maximum extent permitted by law, the
          DALI Lab and Dartmouth College disclaim all warranties, including
          warranties of merchantability, fitness for a particular purpose,
          and non-infringement.
        </p>
      </Section>

      <Section title="Limitation of liability">
        <p>
          To the maximum extent permitted by law, the DALI Lab, Dartmouth
          College, and their staff are not liable for any indirect,
          incidental, special, or consequential damages arising from your use
          of, or inability to use, DALI OS.
        </p>
      </Section>

      <Section title="Termination">
        <p>
          Access may be revoked at the Lab's discretion, including when you
          are no longer affiliated with the Lab. You may stop using the
          application at any time. Provisions intended to survive termination
          — including those concerning ownership, no warranty, and
          limitation of liability — will continue to apply.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about these terms:{" "}
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
