import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Lightweight ScrollArea replacement that avoids the Radix dependency.
 * It simply wraps children in a div with overflow and optional sizing.
 */
export function ScrollArea({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative overflow-auto rounded-md scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
