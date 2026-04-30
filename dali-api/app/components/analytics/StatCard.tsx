interface StatCardProps {
  label: string;
  value: number;
  subtitle?: string;
  color?: string;
}

export function StatCard({ label, value, subtitle, color = "text-foreground" }: StatCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
    </div>
  );
}
