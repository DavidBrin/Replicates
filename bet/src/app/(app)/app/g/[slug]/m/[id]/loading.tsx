import { Skeleton } from "@/components/ui/Skeleton";

/** `loading.tsx` for the market view — shown while `page.tsx`'s Server
 * Component data fetch is in-flight. Mirrors the real layout's shape
 * (header, price panel, order ticket, tabs, Room column) so there's no
 * visible reflow once the real content swaps in. */
export default function MarketPageLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-5 w-56" />
      </div>

      <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <Skeleton className="h-64 rounded-(--radius-card)" />
          <Skeleton className="h-72 rounded-(--radius-card)" />
          <Skeleton className="h-48 rounded-(--radius-card)" />
        </div>
        <Skeleton className="h-[640px] rounded-(--radius-card) xl:w-[360px] xl:shrink-0" />
      </div>
    </div>
  );
}
