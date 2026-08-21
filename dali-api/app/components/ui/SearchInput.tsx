import type { InputHTMLAttributes, ChangeEvent } from "react";
import { Search } from "lucide-react";
import { cn } from "~/lib/cn";
import { useFeatureFlag } from "~/components/FeatureFlags";

export interface SearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  containerClassName?: string;
}

const INPUT_BASE =
  "w-full pl-7 pr-2 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-accent-coral/30";

// The dali.os search bar: the design's pill, roomy enough for its 14px text,
// with the glyph moved in to clear the corner.
const OS_INPUT_BASE =
  "w-full pl-10 pr-4 py-2.5 text-sm border border-border rounded-full bg-card text-foreground placeholder:text-os-muted focus:outline-none focus:ring-2 focus:ring-os-accent/40";

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  containerClassName,
  ...props
}: SearchInputProps) {
  const os = useFeatureFlag("os-redesign");
  return (
    <div className={cn("relative", containerClassName)}>
      <Search
        className={cn(
          "absolute top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none",
          os ? "left-4" : "left-2",
        )}
      />
      <input
        type="search"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={cn(os ? OS_INPUT_BASE : INPUT_BASE, className)}
        {...props}
      />
    </div>
  );
}
