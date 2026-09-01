import { cn } from "@/lib/utils";

export function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & { variant?: "default" | "ok" | "deny" | "warn" }) {
  const styles = {
    default: "bg-muted text-foreground",
    ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    deny: "bg-red-500/15 text-red-700 dark:text-red-300",
    warn: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  } as const;
  return (
    <span
      className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", styles[variant], className)}
      {...props}
    />
  );
}
