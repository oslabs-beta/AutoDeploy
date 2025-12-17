import * as React from "react";
import { cn } from "@/lib/utils"; // if you have this; if not, see note below

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "outline";
}

const badgeVariants: Record<BadgeProps["variant"], string> = {
  default:
    "bg-primary text-primary-foreground",
  secondary:
    "bg-secondary text-secondary-foreground",
  outline:
    "border border-border text-foreground bg-background",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        badgeVariants[variant],
        className
      )}
      {...props}
    />
  );
}
