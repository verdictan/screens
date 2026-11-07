import { shortcutLabel } from "@/lib/shortcuts";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        outline:
          "bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-white hover:bg-destructive/90",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 gap-1.5 px-3 text-xs",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
export function Button({
  className,
  variant,
  size,
  asChild = false,
  shortcut,
  type = "button",
  ...props
}) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      data-shortcut={shortcut}
      title={shortcut ? `${props["aria-label"] || (typeof props.children === "string" ? props.children : "Action")} (${shortcutLabel(shortcut)})` : undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...(!asChild ? { type } : {})}
      {...props}
    />
  );
}
