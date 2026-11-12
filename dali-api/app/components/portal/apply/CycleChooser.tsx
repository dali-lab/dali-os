import { Link } from "react-router";

export type CycleChoice = { id: string; name: string; closeDate: string | null; href: string };

export function CycleChooser({ cycles }: { cycles: CycleChoice[] }) {
  return (
    <div className="py-10 px-6">
      <h1 className="font-heading text-4xl font-medium text-foreground mb-6">Pick a cycle</h1>
      <ul className="flex flex-col gap-3">
        {cycles.map((c) => (
          <li key={c.id}>
            <Link
              to={c.href}
              className="flex items-center justify-between gap-4 rounded-os-card bg-os-card px-5 py-4 hover:border-os-accent/50 transition"
            >
              <span className="font-medium text-foreground">{c.name}</span>
              {c.closeDate && (
                <span className="text-sm text-muted-foreground">
                  Closes{" "}
                  {new Date(c.closeDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
