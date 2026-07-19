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

const INPUT_BASE =
  "w-full pl-7 pr-2 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-accent-coral/30";

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
      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={cn(INPUT_BASE, className)}
        {...props}
      />
    </div>
  );
}
