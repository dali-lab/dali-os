import type { Route } from "./+types/help.shortcuts";

export const meta: Route.MetaFunction = () => [
  { title: "Keyboard shortcuts · Help · DALI OS" },
];

// Source of truth for these bindings is the keydown handler in
// components/TabWorkspace.tsx. Keep this page in sync if those change.
const TABS: Array<[string, string]> = [
  ["⌘ ⌥ →", "Next tab in the focused pane"],
  ["⌘ ⌥ ←", "Previous tab in the focused pane"],
  ["⌘ ⌥ 1–9", "Jump to the Nth tab in the focused pane"],
  ["⌘ ⌥ 0", "Jump to the last tab in the focused pane"],
  ["⌘ ⇧ K", "Close the active tab"],
  ["⌘ ⇧ T", "Reopen the most recently closed tab"],
  ["⌘ \\", "Split: open the active tab to the side, or close the side pane"],
];

const NAV: Array<[string, string]> = [
  ["⌥ ←", "Back inside the current tab"],
  ["⌥ →", "Forward inside the current tab"],
  ["⌘ [", "Back inside the current tab"],
  ["⌘ ]", "Forward inside the current tab"],
  ["Mouse back/forward", "In-tab back/forward (thumb buttons)"],
];

export default function HelpShortcutsPage() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Keyboard shortcuts</h1>
      <p className="mt-2 text-sm text-zinc-600">
        On Windows and Linux, use <Kbd>Ctrl</Kbd> wherever <Kbd>⌘</Kbd> is
        shown. ⌘⌥-combinations avoid clashing with browser shortcuts your
        browser claims (like ⌘W and ⌘1–9).
      </p>

      <Section title="Tabs and panes" rows={TABS} />
      <Section title="In-tab navigation" rows={NAV} />
    </main>
  );
}

function Section({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string]>;
}) {
  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <table className="mt-3 w-full text-sm">
        <tbody>
          {rows.map(([combo, desc]) => (
            <tr
              key={combo}
              className="border-b border-zinc-100 last:border-b-0"
            >
              <td className="w-48 py-2 align-top">
                <Kbd>{combo}</Kbd>
              </td>
              <td className="py-2 text-zinc-700">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-xs text-zinc-700">
      {children}
    </kbd>
  );
}
