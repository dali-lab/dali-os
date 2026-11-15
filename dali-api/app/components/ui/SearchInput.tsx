import { forwardRef, type InputHTMLAttributes, type ChangeEvent, type ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "~/lib/cn";

export interface SearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  // Optional so the same pill also works uncontrolled — a GET filter form can
  // pass `name`/`defaultValue` and let the browser own the value.
  value?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  containerClassName?: string;
  /** "md" is the roomy top-of-page filter; "sm" is the compact in-panel one
   *  (task boards, dropdown filters, dense table toolbars). Same pill either
   *  way — one control read at two scales. */
  size?: "sm" | "md";
  /** Sits at the start of the field in place of the search glyph (a chip for
   *  the scope the search runs inside). */
  leading?: ReactNode;
}

// The one dali.os search field: a card surface with the design's 8px corner, a
// hairline border, a leading glyph, and the accent focus ring. Nothing else
// should hand-roll a search box — reach for this (or <SearchInput size="sm">)
// so a look change lands everywhere at once. The ref forwards to the <input> so
// a modal's initialFocusRef (or any focus/scroll logic) still lands on the field.
const BASE =
  "w-full border border-border rounded-lg bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-os-accent/30";

const SIZES = {
  md: { input: "h-9 pl-10 pr-4 text-sm", icon: "left-4 w-4 h-4" },
  sm: { input: "h-8 pl-9 pr-3 text-sm", icon: "left-3 w-3.5 h-3.5" },
} as const;

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    { value, onChange, placeholder, className, containerClassName, size = "md", leading, ...props },
    ref,
  ) {
    const s = SIZES[size];
    if (leading) {
      return (
        <div
          className={cn(
            BASE,
            "flex items-center gap-1.5 pl-1.5 pr-3 focus-within:ring-2 focus-within:ring-os-accent/30",
            size === "md" ? "h-9" : "h-8",
            containerClassName,
          )}
        >
          {leading}
          <input
            ref={ref}
            type="search"
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            className={cn("h-full min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none", className)}
            {...props}
          />
        </div>
      );
    }
    return (
      <div className={cn("relative", containerClassName)}>
        <Search
          className={cn(
            "absolute top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none",
            s.icon,
          )}
        />
        <input
          ref={ref}
          type="search"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className={cn(BASE, s.input, className)}
          {...props}
        />
      </div>
    );
  },
);
