import type { ReactNode } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "~/lib/cn";
import type { Slide } from "~/components/slides/types";
import { SlideBody } from "./SlideBody";

/** A slide drawn at its fixed 960×540 design size. SlideCanvas scales it to fit. */
export function SlideLayout({ slide, number }: { slide: Slide; number?: number }) {
  const title = slide.title.trim();

  const footer = (dark: boolean) => (
    <div
      className={cn(
        "absolute inset-x-16 bottom-7 flex items-center justify-between text-[13px] font-medium",
        dark ? "text-accent-teal-light" : "text-navy-deep/50",
      )}
    >
      <span>DALI Lab</span>
      {number !== undefined && <span className="tabular-nums">{number}</span>}
    </div>
  );

  const imageBox = (className: string): ReactNode =>
    slide.image?.src.trim() ? (
      <img src={slide.image.src} alt={slide.image.alt} className={cn(className, "object-cover")} />
    ) : (
      <div className={cn(className, "grid place-items-center bg-brand-off text-navy-deep/50")}>
        <span className="flex flex-col items-center gap-3 text-[16px]">
          <ImageIcon className="h-10 w-10" aria-hidden />
          Add an image
        </span>
      </div>
    );

  const heading = (
    <h2 className={cn("text-[40px] font-semibold leading-tight tracking-tight", !title && "text-navy-deep/40")}>
      {title || "Untitled slide"}
    </h2>
  );

  switch (slide.layout) {
    case "title":
      return (
        <div className="relative flex h-full flex-col justify-center bg-navy-deep px-20">
          <h2 className={cn("text-[60px] font-semibold leading-[1.1] tracking-tight", title ? "text-white" : "text-white/40")}>
            {title || "Untitled slide"}
          </h2>
          {slide.subtitle?.trim() && (
            <p className="mt-6 max-w-[720px] text-[26px] leading-snug text-accent-teal-light">{slide.subtitle}</p>
          )}
          {footer(true)}
        </div>
      );
    case "content":
      return (
        <div className="relative h-full bg-brand-white px-16 pt-14 text-navy-deep">
          {heading}
          <SlideBody doc={slide.body} className="mt-7 max-h-[330px] overflow-hidden" />
          {footer(false)}
        </div>
      );
    case "split":
      return (
        <div className="relative h-full bg-brand-white px-16 pt-14 text-navy-deep">
          {heading}
          <div className="mt-7 grid grid-cols-2 gap-10">
            <SlideBody doc={slide.body} className="max-h-[330px] overflow-hidden" />
            {imageBox("h-[330px] w-full rounded-2xl")}
          </div>
          {footer(false)}
        </div>
      );
    case "image":
      return (
        <div className="relative h-full bg-navy-deep">
          {imageBox("h-full w-full")}
          {title && <p className="absolute inset-x-0 bottom-0 bg-navy-deep px-16 py-6 text-[24px] font-medium text-white">{title}</p>}
        </div>
      );
  }
}
