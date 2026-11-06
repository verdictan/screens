import { cn } from "@/lib/utils";
export function Input({ className, type, ...props }) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        "flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 file:border-0 file:bg-transparent file:text-sm",
        className,
      )}
      {...props}
    />
  );
}
