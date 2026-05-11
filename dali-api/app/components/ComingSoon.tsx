import { Sparkles } from "lucide-react";

interface ComingSoonProps {
  title: string;
  description?: string;
}

export function ComingSoon({ title, description }: ComingSoonProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-12 h-12 rounded-full bg-accent-coral/10 text-accent-coral flex items-center justify-center mb-4">
        <Sparkles className="w-5 h-5" />
      </div>
      <h1 className="text-2xl font-bold text-foreground mb-2">{title}</h1>
      {description && (
        <p className="text-muted-foreground max-w-md">{description}</p>
      )}
      <p className="mt-6 text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">
        Coming soon
      </p>
    </div>
  );
}
