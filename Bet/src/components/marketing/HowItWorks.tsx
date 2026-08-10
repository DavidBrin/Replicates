import { CircleDollarSign, MessageSquareText, Trophy, UserPlus } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

interface Step {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  { icon: CircleDollarSign, title: "Create a bet", body: "Ask a question, set how it resolves." },
  { icon: UserPlus, title: "Invite your people", body: "Friends first, tappable — or send a link." },
  { icon: MessageSquareText, title: "Prices move as they bet", body: "Every buy shifts the odds live." },
  { icon: Trophy, title: "It settles, chat has receipts", body: "Payouts land, the tape stays in the room." },
];

/** The "how it works" strip (task-14a brief): create → invite → trade →
 * settle, four short beats. Server-renderable. */
export function HowItWorks() {
  return (
    <section className="mx-auto w-full max-w-[1320px] px-6 sm:px-10">
      <div className="grid grid-cols-1 gap-8 border-t border-(--border) pt-12 sm:grid-cols-2 xl:grid-cols-4 xl:gap-6">
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <div key={title} className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="tnum inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-(--border-2) text-xs font-medium text-(--text-2)">
                {i + 1}
              </span>
              <Icon className="size-5 text-(--accent)" aria-hidden="true" />
            </div>
            <h3 className="text-sm font-semibold text-(--text-1)">{title}</h3>
            <p className="text-sm leading-relaxed text-(--text-2)">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
