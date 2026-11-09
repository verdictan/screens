import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
const variants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "text-primary",
        secondary: "text-muted-foreground",
        outline: "text-muted-foreground",
        success: "text-success",
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
