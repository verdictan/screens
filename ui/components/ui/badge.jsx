import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
const variants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-muted-foreground",
        success: "border-success/25 bg-success-surface text-success",
      },
    },
    defaultVariants: { variant: "secondary" },
  },
);
export function Badge({ variant, className, ...props }) {
  return (
    <span
      data-slot="badge"
      className={cn(variants({ variant }), className)}
      {...props}
    />
  );
}
