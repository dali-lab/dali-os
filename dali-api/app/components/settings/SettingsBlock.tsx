// A single settings section. Always expanded — only the active tab's blocks
// are mounted, so the old accordion collapse has nothing left to do.
export function SettingsBlock({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="border border-border rounded-lg scroll-mt-4">
      <div className="px-4 py-3">
        <h2 className="font-heading text-lg font-semibold text-foreground">{title}</h2>
        {description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="border-t border-border px-4 py-5">{children}</div>
    </section>
  );
}
