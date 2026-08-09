import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { CTA } from "./copy";

/**
 * The hero's button pair, reused verbatim in the closing CTA band.
 *
 * Note these are *blue* — the black pill belongs to the nav. Both are links
 * rather than buttons because they navigate.
 */
export function CtaPair({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-center gap-3",
        className,
      )}
    >
      <Link href={CTA.primary.href} className="mkt-cta mkt-cta--primary">
        {CTA.primary.label}
      </Link>
      <Link href={CTA.secondary.href} className="mkt-cta mkt-cta--soft">
        {CTA.secondary.label}
      </Link>
    </div>
  );
}
