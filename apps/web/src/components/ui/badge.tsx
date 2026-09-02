import { cn } from "@/lib/utils";

export function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & { variant?: "default" | "ok" | "deny" | "warn" }) {
  const styles = {
    default: "bg-[#0d94fb]/15 text-[#7ec8ff]",
    ok: "bg-[#3dd68c]/15 text-[#3dd68c]",
    deny: "bg-[#f07167]/15 text-[#f07167]",
    warn: "bg-[#f5c16c]/15 text-[#f5c16c]",
  } as const;
  return (
    <span
      className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", styles[variant], className)}
      {...props}
    />
  );
}
