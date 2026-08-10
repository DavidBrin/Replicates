import { Lock, MessagesSquare, TrendingUp } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { Card } from "@/components/ui/Card";

interface Feature {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  body: string;
}

const FEATURES: Feature[] = [
  {
    icon: Lock,
    title: "Private by default",
    body: "Every bet lives inside a group. Nobody outside it — not even other Bet users — can see the question exists.",
  },
  {
    icon: TrendingUp,
    title: "Priced by your group",
    body: "No admin sets the odds. Each buy shifts the price automatically, so 72% means your friends actually put credits behind it.",
  },
  {
    icon: MessagesSquare,
    title: "The chat is the market",
    body: "Every trade posts to the room the second it clears — “dev bought 40 No @ 29¢” sits right between the messages. The tape is the conversation.",
  },
];

/** SPEC §3.1's three feature panels. Server-renderable. */
export function FeaturePanels() {
  return (
    <section className="mx-auto w-full max-w-[1320px] px-6 sm:px-10">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <Card key={title} className="flex flex-col gap-4 bg-(--surface-1) p-6">
            <span className="inline-flex size-10 items-center justify-center rounded-(--radius-input) bg-(--accent)/12 text-(--accent)">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <h3 className="text-base font-semibold text-(--text-1)">{title}</h3>
            <p className="text-sm leading-relaxed text-(--text-2)">{body}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}
