import { cn } from "@/lib/utils";
export function Card({ className, ...props }) {
  return (
    <section
      data-slot="card"
      className={cn(
        "rounded-lg bg-card text-card-foreground",
        className,
      )}
      {...props}
    />
  );
}
export function CardHeader({ className, ...props }) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1.5 p-5", className)}
      {...props}
    />
  );
}
export function CardTitle({ className, ...props }) {
  return (
    <h2
      data-slot="card-title"
      className={cn("font-semibold leading-none", className)}
      {...props}
    />
  );
}
export function CardDescription({ className, ...props }) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}
export function CardContent({ className, ...props }) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-5 pb-5", className)}
      {...props}
    />
  );
}
