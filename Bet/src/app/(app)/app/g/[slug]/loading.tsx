import { Skeleton } from "@/components/ui/Skeleton";

/**
 * `loading.tsx` for the group dashboard (task-9-brief: "add loading.tsx
 * with Skeleton-based placeholders for the dashboard"). Shown by Next.js
 * automatically while `page.tsx`'s Server Component data fetch is
 * in-flight. Mirrors the real layout's shape (header row, section
 * headings, a card grid) so there's no visible reflow once the real
 * content swaps in.
 */
export default function GroupDashboardLoading() {
  return (
    <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:gap-8">
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="h-6 w-40" />
            </div>
            <Skeleton className="h-5 w-24" />
          </div>
          <Skeleton className="h-9 w-full" />
        </div>

        <div className="flex flex-col gap-3">
          <Skeleton className="h-5 w-28" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-48 rounded-(--radius-card)" />
            ))}
          </div>
        </div>
      </div>

      <div className="hidden w-72 shrink-0 flex-col gap-4 xl:flex">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-(--radius-card)" />
        ))}
      </div>
    </div>
  );
}
