import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { getContainer } from "@/lib/container";
import { requireCurrentUser } from "@/lib/server-actor";
import { EmptyState } from "@/components/ui/EmptyState";
import { CreateGroupButton } from "@/components/app-shell/CreateGroupButton";

/**
 * `/app` (SPEC §2: "Redirects to the user's first group"; task-9-brief:
 * "resolves the user's first group and redirects; if the user has no
 * groups, show an onboarding empty state"). Server Component — a plain
 * container read, no client-side redirect flash.
 */
export default async function AppIndexPage() {
  const user = await requireCurrentUser();
  const { store } = await getContainer();
  const groups = await store.groups.listByMember(user.id);

  if (groups.length > 0) {
    redirect(`/app/g/${groups[0]!.slug}`);
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <EmptyState
        icon={<Users className="size-8" />}
        title="You're not in any groups yet"
        description="Groups are where Bet's markets live — create one to start betting with your friends."
        action={<CreateGroupButton variant="cta" />}
      />
    </div>
  );
}
