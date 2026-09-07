import type { InputHTMLAttributes, ChangeEvent } from "react";
import { Search } from "lucide-react";
import { cn } from "~/lib/cn";

export interface SearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  containerClassName?: string;
}

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
  return (
    <div className={cn("relative", containerClassName)}>
      <Search
        className={cn(
          "absolute top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none",
          "left-4",
        )}
      />
      <input
        type="search"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={cn(OS_INPUT_BASE, className)}
        {...props}
      />
    </div>
  );
}
