export function CycleSetupSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card px-6 py-5">
      <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-dark-blue">
        {title}
      </h2>
      {description && <p className="text-xs text-muted-foreground mt-1 mb-4">{description}</p>}
      <div className={description ? "" : "mt-4"}>{children}</div>
    </section>
  );
}
