import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  children: ReactNode;
}

export function Card({ interactive, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "relative rounded-lg bg-surface ring-1 ring-line p-6 sm:p-8 shadow-card",
        "transition-[transform,box-shadow,background,ring] duration-300",
        interactive && [
          "hover:ring-brand-navy/30 hover:-translate-y-0.5 hover:shadow-glow",
          "focus-within:ring-brand-navy/40",
        ],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
