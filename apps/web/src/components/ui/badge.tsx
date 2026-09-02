import { cn } from "@/lib/utils";

export function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & { variant?: "default" | "ok" | "deny" | "warn" }) {
  const styles = {
    default: "bg-[#e8f4ff] text-[#0b6fbe]",
    ok: "bg-[#e5f8ef] text-[#027a48]",
    deny: "bg-[#fdecec] text-[#b42318]",
    warn: "bg-[#fff6e5] text-[#9a6700]",
  } as const;
  return (
    <span
      className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", styles[variant], className)}
      {...props}
    />
  );
}
