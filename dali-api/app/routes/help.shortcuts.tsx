import type { Route } from "./+types/help.shortcuts";
import { SHORTCUT_SECTIONS, type ShortcutSection } from "~/lib/shortcuts";

export const meta: Route.MetaFunction = () => [
  { title: "Keyboard shortcuts · Help · DALI OS" },
];

export default function HelpShortcutsPage() {
  return (
    <main className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Keyboard shortcuts</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        On Windows and Linux, use <Kbd>Ctrl</Kbd> wherever <Kbd>⌘</Kbd> is
        shown and <Kbd>Alt</Kbd> wherever <Kbd>⌥</Kbd> is shown.
      </p>

      {SHORTCUT_SECTIONS.map((section) => (
        <Section key={section.title} section={section} />
      ))}
    </main>
  );
}

function Section({ section }: { section: ShortcutSection }) {
  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold">{section.title}</h2>
      <table className="mt-3 w-full text-sm">
        <tbody>
          {section.rows.map(({ keys, action }) => (
            <tr
              key={`${keys} ${action}`}
              className="border-b border-border last:border-b-0"
            >
              <td className="w-48 py-2 align-top">
                <Kbd>{keys}</Kbd>
              </td>
              <td className="py-2 text-foreground">{action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
      {children}
    </kbd>
  );
}
