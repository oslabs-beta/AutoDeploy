import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Glassy base for all variants
const glassBase =
  "border border-white/30 bg-white/10 text-slate-100 backdrop-blur-md shadow-glass hover:bg-white/20";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: glassBase,
        glass: glassBase,
        glassSolid:
          "border border-white/40 bg-white/20 text-slate-900 hover:bg-white/30 backdrop-blur-md shadow-glass",
        destructive:
          "border border-red-300/60 bg-red-500/20 text-red-50 backdrop-blur-md shadow-glass hover:bg-red-500/30",
        outline:
          "border border-white/40 bg-white/5 text-slate-100 hover:bg-white/15 backdrop-blur-md shadow-glass",
        secondary:
          "border border-white/20 bg-white/15 text-slate-100 hover:bg-white/25 backdrop-blur-md shadow-glass",
        ghost:
          "border border-transparent bg-white/5 text-slate-100 hover:bg-white/10 backdrop-blur-md shadow-glass",
        link:
          "border border-transparent bg-transparent text-slate-100 underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "glass",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
