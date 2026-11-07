import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";
export function Tabs({ className, ...props }) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("review-tabs", className)}
      {...props}
    />
  );
}
export function TabsList({ className, ...props }) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-10 w-fit max-w-full items-center gap-3 overflow-x-auto text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
export function TabsTrigger({ className, ...props }) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 relative px-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
export function TabsContent({ className, ...props }) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      data-page={props.value}
      forceMount
      hidden={props.inert}
      className={cn(
        "min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}
