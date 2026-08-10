import { Skeleton } from "@/components/ui/Skeleton";

/** `/app` just resolves the first group and redirects — this only shows
 * for the brief instant that read takes. */
export default function AppIndexLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Skeleton className="h-32 w-64 rounded-(--radius-card)" />
    </div>
  );
}
