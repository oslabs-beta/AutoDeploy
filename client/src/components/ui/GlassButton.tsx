import * as React from "react";

type GlassButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export function GlassButton({
  children,
  className = "",
  disabled,
  ...props
}: GlassButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled}
      className={[
        "px-4 py-2 rounded-lg border border-white/30",
        "bg-white/10 backdrop-blur-md text-slate-100",
        "hover:bg-white/20 hover:shadow-glass",
        "transition-all duration-300",
        "disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-white/10",
        className,
      ].join(" ")}
    >
      {children}
    </button>
  );
}
